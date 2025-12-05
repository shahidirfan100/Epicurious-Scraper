// Epicurious Recipes Scraper - Production-ready Actor with JSON-first + HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

await Actor.init();

const normalize = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
    return String(value).replace(/\s+/g, ' ').trim() || null;
};

const toAbs = (href, base = 'https://www.epicurious.com') => {
    try {
        return new URL(href, base).href.split('#')[0];
    } catch {
        return null;
    }
};

const arrify = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const uniq = (list) => [...new Set(list.filter(Boolean))];

const buildHeaders = () => ({
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
});

const parseJsonLdScripts = ($) => {
    const parsed = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw) return;
        try {
            const json = JSON.parse(raw);
            if (Array.isArray(json)) {
                parsed.push(...json);
            } else if (json?.['@graph']) {
                parsed.push(...arrify(json['@graph']));
            } else {
                parsed.push(json);
            }
        } catch {
            // Malformed LD blocks are common; ignore and continue
        }
    });
    return parsed;
};

const extractListLinks = (jsonNodes, base) => {
    const urls = [];
    for (const node of jsonNodes) {
        if (!node) continue;
        const type = node['@type'] || node.type;
        const isItemList = type === 'ItemList' || (Array.isArray(type) && type.includes('ItemList'));
        if (isItemList && Array.isArray(node.itemListElement)) {
            for (const entry of node.itemListElement) {
                const raw = entry.url || entry.item?.url;
                const url = toAbs(raw, base);
                if (url && /\/recipes\/food\/views\//.test(url)) urls.push(url);
            }
        }
    }
    return urls;
};

const collectInstructionLines = (instructions) => {
    const steps = [];
    const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node === 'string') {
            const clean = normalize(node);
            if (clean) steps.push(clean);
            return;
        }
        if (typeof node === 'object') {
            if (node.text || node.description) {
                const text = normalize(node.text || node.description);
                if (text) steps.push(text);
            }
            if (node.itemListElement) walk(node.itemListElement);
        }
    };
    walk(instructions);
    return uniq(steps);
};

const pickImage = (image) => {
    if (!image) return null;
    if (typeof image === 'string') return image;
    if (Array.isArray(image)) {
        for (const img of image) {
            const candidate = pickImage(img);
            if (candidate) return candidate;
        }
    }
    if (typeof image === 'object') return image.url || image['@id'] || null;
    return null;
};

const extractRecipeFromJsonLd = (jsonNodes) => {
    for (const node of jsonNodes) {
        if (!node) continue;
        const possible = Array.isArray(node) ? node : [node];
        for (const item of possible) {
            const type = item?.['@type'] || item?.type;
            const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
            if (!isRecipe) continue;
            const keywords = item.keywords
                ? (Array.isArray(item.keywords) ? item.keywords : String(item.keywords).split(','))
                : [];
            const instructions = collectInstructionLines(item.recipeInstructions);
            const ingredients = arrify(item.recipeIngredient).map(normalize).filter(Boolean);
            return {
                title: normalize(item.name),
                author: normalize(
                    Array.isArray(item.author)
                        ? item.author.map((a) => (typeof a === 'object' ? a.name : a)).join(', ')
                        : typeof item.author === 'object'
                            ? item.author?.name
                            : item.author,
                ),
                description: normalize(item.description),
                prep_time: normalize(item.prepTime),
                cook_time: normalize(item.cookTime),
                total_time: normalize(item.totalTime),
                servings: normalize(item.recipeYield),
                ingredients,
                instructions,
                tags: uniq([
                    ...arrify(item.recipeCuisine).map(normalize),
                    ...arrify(item.recipeCategory).map(normalize),
                    ...keywords.map(normalize),
                ]).filter(Boolean),
                image_url: pickImage(item.image),
                cuisine: normalize(arrify(item.recipeCuisine)[0]),
                category: normalize(arrify(item.recipeCategory)[0]),
                difficulty: item.aggregateRating?.ratingValue
                    ? `Rated ${item.aggregateRating.ratingValue}`
                    : null,
                date_published: normalize(item.datePublished),
                rating_value: item.aggregateRating?.ratingValue || null,
                rating_count: item.aggregateRating?.ratingCount || item.aggregateRating?.reviewCount || null,
                rating_best: item.aggregateRating?.bestRating || null,
                rating_worst: item.aggregateRating?.worstRating || null,
                nutrition: item.nutrition || null,
            };
        }
    }
    return null;
};

const parseHtmlRecipe = ($) => {
    const title =
        normalize($('h1').first().text()) ||
        normalize($('[data-testid*="hed"], [class*="headline"]').first().text());
    const author =
        normalize($('[rel="author"]').first().text()) ||
        normalize($('[class*="byline"] a, [class*="contributor"]').first().text());
    const description =
        normalize($('[data-testid*="dek"], [class*="description"], [class*="subheading"]').first().text()) ||
        normalize($('meta[name="description"]').attr('content'));
    const servings =
        normalize($('[data-testid*="servings"], [class*="yield"], [class*="servings"]').first().text()) ||
        normalize($('meta[itemprop="recipeYield"]').attr('content'));

    const ingredients = [];
    $('li[data-testid*="ingredient"], li[class*="ingredient"], .ingredient, .ingredient-group li').each((_, el) => {
        const text = normalize($(el).text());
        if (text) ingredients.push(text);
    });

    const instructions = [];
    $('li[data-testid*="instruction"], [class*="instruction"], .preparation-steps li, ol li, .step, .direction').each(
        (_, el) => {
            const text = normalize($(el).text());
            if (text) instructions.push(text);
        },
    );

    const prepTime =
        normalize($('time[itemprop="prepTime"]').text()) ||
        normalize($('[data-testid*="prep-time"], [class*="prep-time"]').first().text());
    const cookTime =
        normalize($('time[itemprop="cookTime"]').text()) ||
        normalize($('[data-testid*="cook-time"], [class*="cook-time"]').first().text());
    const totalTime =
        normalize($('time[itemprop="totalTime"]').text()) ||
        normalize($('[data-testid*="total-time"], [class*="total-time"]').first().text());

    const image =
        $('meta[property="og:image"]').attr('content') ||
        $('img[data-testid*="image"], img[class*="recipe"]').first().attr('src');

    const tags = [];
    $('[data-testid*="tag"], a[href*="tags/"]').each((_, el) => {
        const text = normalize($(el).text());
        if (text) tags.push(text);
    });

    return {
        title,
        author,
        description,
        prep_time: prepTime,
        cook_time: cookTime,
        total_time: totalTime,
        servings,
        ingredients: uniq(ingredients),
        instructions: uniq(instructions),
        image_url: image || null,
        tags: uniq(tags),
    };
};

const mergeRecipe = (base, extra) => {
    if (!extra) return base || {};
    const merged = { ...(base || {}) };
    const fields = [
        'title',
        'author',
        'description',
        'prep_time',
        'cook_time',
        'total_time',
        'servings',
        'image_url',
        'cuisine',
        'category',
        'difficulty',
        'date_published',
        'rating_value',
        'rating_count',
        'rating_best',
        'rating_worst',
    ];
    for (const field of fields) {
        if (!merged[field] && extra[field]) merged[field] = extra[field];
    }
    if (extra.ingredients?.length) {
        merged.ingredients = uniq([...(merged.ingredients || []), ...extra.ingredients]);
    }
    if (extra.instructions?.length) {
        merged.instructions = uniq([...(merged.instructions || []), ...extra.instructions]);
    }
    if (extra.tags?.length) {
        merged.tags = uniq([...(merged.tags || []), ...extra.tags]);
    }
    if (extra.nutrition && !merged.nutrition) merged.nutrition = extra.nutrition;
    return merged;
};

const hasCoreRecipeData = (recipe) =>
    Boolean(recipe?.title && recipe?.ingredients?.length && recipe?.instructions?.length);

const buildAlternateDetailUrls = (url) => {
    const cleaned = url.split('?')[0].replace(/\/$/, '');
    const alternates = [cleaned, `${cleaned}?output=1`, `${cleaned}?page=all`, `${cleaned}/amp`];
    return uniq(alternates);
};

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrl = 'https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes',
            recipeType = 'vegetarian',
            results_wanted: RESULTS_WANTED_RAW = 50,
            max_pages: MAX_PAGES_RAW = 10,
            collectDetails: COLLECT_DETAILS_RAW,
            proxyConfiguration,
            dedupe = true,
        } = input;

        // Respect the UI toggle: default true, but if user sets false, only URLs are collected
        const collectDetails =
            COLLECT_DETAILS_RAW === undefined ? true : Boolean(COLLECT_DETAILS_RAW);

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW)
            ? Math.max(1, +RESULTS_WANTED_RAW)
            : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 10;

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        let saved = 0;
        const seenUrls = dedupe ? new Set() : null;

        const findRecipeLinks = ($, base) => {
            const urls = new Set();
            $('a[href*="/recipes/food/views/"], [data-link-type="recipe"] a, .recipe-card a').each((_, el) => {
                const href = $(el).attr('href');
                const abs = href ? toAbs(href, base) : null;
                if (!abs) return;
                if (/\/recipes\/food\/views\//.test(abs)) {
                    const clean = abs.split('?')[0];
                    if (!seenUrls || !seenUrls.has(clean)) {
                        urls.add(clean);
                        if (seenUrls) seenUrls.add(clean);
                    }
                }
            });
            return [...urls];
        };

        const findNextPage = ($, base) => {
            const rel = $('a[rel="next"]').attr('href');
            if (rel) return toAbs(rel, base);

            const aria =
                $('a[aria-label*="next"], a[data-testid*="next"]').first().attr('href') ||
                $('button[aria-label*="next"]').parent('a').attr('href');
            if (aria) return toAbs(aria, base);

            const textNext = $('a')
                .filter((_, el) => /^(next|>|\u00bb)$/i.test($(el).text().trim()))
                .first()
                .attr('href');
            if (textNext) return toAbs(textNext, base);
            return null;
        };

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            additionalMimeTypes: ['application/json'],
            preNavigationHooks: [
                async ({ request }) => {
                    request.headers = { ...(request.headers || {}), ...buildHeaders() };
                },
            ],
            async requestHandler({ request, $, enqueueLinks, proxyInfo, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(
                        `Listing page ${pageNo}: ${request.url} | collectDetails=${collectDetails}`,
                    );
                    const ldNodes = parseJsonLdScripts($);
                    const jsonLinks = extractListLinks(ldNodes, request.url);
                    const htmlLinks = findRecipeLinks($, request.url);
                    const combined = uniq([...jsonLinks, ...htmlLinks]);
                    const remaining = RESULTS_WANTED - saved;
                    const limited = remaining < combined.length ? combined.slice(0, remaining) : combined;
                    crawlerLog.info(
                        `Found ${combined.length} recipe links (JSON-LD + HTML). Enqueueing ${limited.length}`,
                    );

                    if (collectDetails && limited.length) {
                        await enqueueLinks({ urls: limited, userData: { label: 'DETAIL' } });
                    } else if (!collectDetails && limited.length) {
                        await Dataset.pushData(
                            limited.map((u) => ({
                                title: normalize(u.split('/').pop()?.replace(/-/g, ' ')) || 'Recipe',
                                url: u,
                                recipe_type: recipeType,
                                _source: 'epicurious.com',
                            })),
                        );
                        saved += limited.length;
                        crawlerLog.info(`Saved ${saved}/${RESULTS_WANTED} recipe URLs`);
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextUrl = findNextPage($, request.url);
                        if (nextUrl) {
                            await enqueueLinks({
                                urls: [nextUrl],
                                userData: { label: 'LIST', pageNo: pageNo + 1 },
                            });
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
                        const ldNodes = parseJsonLdScripts($);
                        let recipe = extractRecipeFromJsonLd(ldNodes) || {};
                        recipe = mergeRecipe(recipe, parseHtmlRecipe($));

                        if (!hasCoreRecipeData(recipe)) {
                            const altCandidates = buildAlternateDetailUrls(request.url);
                            for (const altUrl of altCandidates) {
                                try {
                                    const res = await gotScraping({
                                        url: altUrl,
                                        headers: buildHeaders(),
                                        proxyUrl: proxyInfo?.url,
                                        timeout: { request: 20000 },
                                        http2: true,
                                        throwHttpErrors: false,
                                    });
                                    if (res.statusCode >= 200 && res.statusCode < 400 && res.body) {
                                        const $alt = cheerioLoad(res.body);
                                        const altRecipe = mergeRecipe(
                                            extractRecipeFromJsonLd(parseJsonLdScripts($alt)),
                                            parseHtmlRecipe($alt),
                                        );
                                        recipe = mergeRecipe(recipe, altRecipe);
                                        if (hasCoreRecipeData(recipe)) break;
                                    }
                                } catch (err) {
                                    crawlerLog.debug(`Alt fetch failed for ${altUrl}: ${err.message}`);
                                }
                            }
                        }

                        if (!recipe.title) {
                            recipe.title =
                                normalize(request.url.split('/').pop()?.replace(/-/g, ' ')) ||
                                'Untitled Recipe';
                        }

                        const item = {
                            title: recipe.title,
                            author: recipe.author || null,
                            description: recipe.description || null,
                            recipe_type: recipeType,
                            ingredients: recipe.ingredients || [],
                            ingredients_count: recipe.ingredients ? recipe.ingredients.length : 0,
                            instructions: recipe.instructions?.join(' | ') || null,
                            instructions_list: recipe.instructions || [],
                            prep_time: recipe.prep_time || null,
                            cook_time: recipe.cook_time || null,
                            total_time: recipe.total_time || null,
                            servings: recipe.servings || null,
                            difficulty: recipe.difficulty || null,
                            cuisine: recipe.cuisine || null,
                            category: recipe.category || null,
                            tags: recipe.tags || [],
                            image_url: recipe.image_url || null,
                            date_published: recipe.date_published || null,
                            rating_value: recipe.rating_value || null,
                            rating_count: recipe.rating_count || null,
                            rating_best: recipe.rating_best || null,
                            rating_worst: recipe.rating_worst || null,
                            nutrition: recipe.nutrition || null,
                            url: request.url,
                            scraped_at: new Date().toISOString(),
                            _source: 'epicurious.com',
                        };

                        await Dataset.pushData(item);
                        saved += 1;
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

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
