// Epicurious Recipes Scraper - Production-Ready Actor
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrl = 'https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes',
            recipeType = 'vegetarian',
            results_wanted: RESULTS_WANTED_RAW = 50,
            max_pages: MAX_PAGES_RAW = 10,
            collectDetails = true,
            proxyConfiguration,
            dedupe = true,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 10;

        const toAbs = (href, base = 'https://www.epicurious.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        const seenUrls = dedupe ? new Set() : null;

        // Extract structured data from JSON-LD scripts
        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) {
                            return {
                                title: e.name || null,
                                author: e.author && e.author.name ? e.author.name : null,
                                description: e.description || null,
                                prepTime: e.prepTime || null,
                                cookTime: e.cookTime || null,
                                totalTime: e.totalTime || null,
                                servings: e.recipeYield || null,
                                ingredients: Array.isArray(e.recipeIngredient) ? e.recipeIngredient : [],
                                instructions: e.recipeInstructions ? (Array.isArray(e.recipeInstructions) ? e.recipeInstructions.map(i => typeof i === 'string' ? i : i.text).join(' ') : e.recipeInstructions) : null,
                                image: e.image ? (typeof e.image === 'string' ? e.image : e.image[0]?.url || e.image.url) : null,
                                cuisine: e.recipeCuisine || null,
                                category: e.recipeCategory || null,
                                difficulty: e.aggregateRating ? e.aggregateRating.ratingValue : null,
                                datePublished: e.datePublished || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        // Find recipe links on listing pages
        function findRecipeLinks($, base) {
            const links = new Set();
            
            // Primary selectors for Epicurious recipe links
            $('a[href*="/recipes/"], [data-link-type="recipe"] a, .recipe-card a').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                
                // Ensure it's a recipe URL and not a section/filter link
                if (/\/recipes\//.test(href) && !/\/recipes-menus\//.test(href) && !/filter/.test(href)) {
                    const abs = toAbs(href, base);
                    if (abs && !abs.includes('?')) {
                        // Remove tracking parameters
                        const cleanUrl = abs.split('?')[0].split('#')[0];
                        if (dedupe) {
                            if (!seenUrls.has(cleanUrl)) {
                                links.add(cleanUrl);
                                seenUrls.add(cleanUrl);
                            }
                        } else {
                            links.add(cleanUrl);
                        }
                    }
                }
            });
            
            return [...links];
        }

        // Find next pagination link
        function findNextPage($, base) {
            // Look for next button by rel attribute
            const rel = $('a[rel="next"]').attr('href');
            if (rel) return toAbs(rel, base);
            
            // Fallback: look for pagination button
            const next = $('a[aria-label*="next"], a[data-testid*="next"], button[aria-label*="next"]').first().parent('a').attr('href') ||
                         $('a[aria-label*="next"], a[data-testid*="next"]').first().attr('href');
            if (next) return toAbs(next, base);
            
            // Last resort: look for common "Next" text patterns
            const textNext = $('a').filter((_, el) => {
                const text = $(el).text().toLowerCase();
                return /^\s*(next|›|»|>)\s*$/.test(text);
            }).first().attr('href');
            if (textNext) return toAbs(textNext, base);
            
            return null;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 60,
            additionalMimeTypes: ['application/json'],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(`Listing page ${pageNo}: ${request.url}`);
                    const links = findRecipeLinks($, request.url);
                    crawlerLog.info(`Found ${links.length} recipe links on page ${pageNo}`);

                    if (collectDetails && links.length > 0) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                            crawlerLog.info(`Enqueued ${toEnqueue.length} recipes for detail extraction`);
                        }
                    } else if (!collectDetails && links.length > 0) {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = links.slice(0, Math.max(0, remaining));
                        if (toPush.length) {
                            await Dataset.pushData(toPush.map(u => ({
                                title: u.split('/').pop().replace(/-/g, ' '),
                                url: u,
                                recipe_type: recipeType,
                                _source: 'epicurious.com'
                            })));
                            saved += toPush.length;
                            crawlerLog.info(`Saved ${saved}/${RESULTS_WANTED} recipes`);
                        }
                    }

                    // Handle pagination
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextUrl = findNextPage($, request.url);
                        if (nextUrl) {
                            await enqueueLinks({ urls: [nextUrl], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                            crawlerLog.info(`Found next page: ${nextUrl}`);
                        } else {
                            crawlerLog.info('No next page found - pagination complete');
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    try {
                        // First, try to extract structured data
                        let data = extractFromJsonLd($);
                        
                        if (!data) {
                            data = {};
                        }

                        // Fallback HTML parsing if JSON-LD is incomplete
                        if (!data.title) {
                            data.title = $('h1').first().text().trim() ||
                                        $('[class*="recipe-title"]').first().text().trim() ||
                                        $('.headline').first().text().trim() || null;
                        }

                        if (!data.author) {
                            data.author = $('[class*="author"], .by-line, [rel="author"]').first().text().trim() || null;
                        }

                        if (!data.description) {
                            const descSelector = '[class*="description"], .subheading, [class*="lead"]';
                            data.description = $(descSelector).first().text().trim() || null;
                        }

                        if (!data.ingredients || data.ingredients.length === 0) {
                            const ingredients = [];
                            $('[class*="ingredient"], .ingredient-group li, .ingredient-line').each((_, el) => {
                                const text = $(el).text().trim();
                                if (text) ingredients.push(text);
                            });
                            data.ingredients = ingredients.slice(0, 50); // Cap at 50 ingredients
                        }

                        if (!data.instructions) {
                            const instructions = [];
                            $('[class*="instruction"], .instruction-step, .step').each((_, el) => {
                                const text = $(el).text().trim();
                                if (text) instructions.push(text);
                            });
                            data.instructions = instructions.length > 0 ? instructions.join(' | ') : null;
                        }

                        if (!data.prepTime) {
                            data.prepTime = $('[class*="prep-time"]').first().text().trim() || null;
                        }

                        if (!data.cookTime) {
                            data.cookTime = $('[class*="cook-time"]').first().text().trim() || null;
                        }

                        if (!data.servings) {
                            data.servings = $('[class*="yield"], [class*="servings"]').first().text().trim() || null;
                        }

                        if (!data.image) {
                            data.image = $('img[alt*="recipe"], img[class*="recipe"], img.recipe-image').first().attr('src') ||
                                        $('img[alt]').first().attr('src') || null;
                        }

                        if (!data.difficulty) {
                            data.difficulty = $('[class*="difficulty"], [class*="level"]').first().text().trim() || null;
                        }

                        // Clean instruction HTML if present
                        if (data.instructions && typeof data.instructions === 'string' && data.instructions.includes('<')) {
                            data.instructions = cleanText(data.instructions);
                        }

                        const item = {
                            title: data.title || 'Untitled Recipe',
                            author: data.author || null,
                            description: data.description || null,
                            recipe_type: recipeType,
                            ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
                            ingredients_count: Array.isArray(data.ingredients) ? data.ingredients.length : 0,
                            instructions: data.instructions || null,
                            prep_time: data.prepTime || null,
                            cook_time: data.cookTime || null,
                            total_time: data.totalTime || null,
                            servings: data.servings || null,
                            difficulty: data.difficulty || null,
                            cuisine: data.cuisine || null,
                            category: data.category || null,
                            image_url: data.image || null,
                            date_published: data.datePublished || null,
                            url: request.url,
                            scraped_at: new Date().toISOString(),
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved recipe ${saved}/${RESULTS_WANTED}: ${item.title}`);
                    } catch (err) {
                        crawlerLog.error(`Detail page ${request.url} failed: ${err.message}`);
                    }
                }
            },
            errorHandler: async ({ request, error, log: crawlerLog }) => {
                crawlerLog.error(`Request failed: ${request.url} - ${error.message}`);
            },
        });

        await crawler.run([{ url: startUrl, userData: { label: 'LIST', pageNo: 1 } }]);
        log.info(`Scraping completed. Total recipes saved: ${saved}`);

    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
