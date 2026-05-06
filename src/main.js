import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

const BASE_URL = 'https://www.epicurious.com';
const DETAIL_CONCURRENCY = 25;
const DATASET_BATCH_SIZE = 10;
const REQUEST_RETRIES = 2;

const normalize = (value) => {
    if (value === undefined || value === null) return null;
    let text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    
    // Basic HTML unescape
    const entities = {
        '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>',
        '&rsquo;': "'", '&lsquo;': "'", '&rdquo;': '"', '&ldquo;': '"',
        '&nbsp;': ' ', '&ndash;': '-', '&mdash;': '--',
    };
    for (const [entity, char] of Object.entries(entities)) {
        text = text.replace(new RegExp(entity, 'g'), char);
    }
    
    return text.trim() || null;
};

const arrify = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const uniq = (list) => [...new Set(list.filter(Boolean))];

const toAbs = (value, base = BASE_URL) => {
    try {
        return new URL(value, base).href.split('#')[0];
    } catch {
        return null;
    }
};

const cleanImageUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    try {
        const u = new URL(url);
        u.search = '';
        u.hash = '';
        return u.href;
    } catch {
        return url;
    }
};

const normalizeRecipeUrl = (url) => {
    const abs = toAbs(url, BASE_URL);
    if (!abs) return null;
    try {
        const parsed = new URL(abs);
        parsed.search = '';
        parsed.hash = '';
        return parsed.href.replace(/\/$/, '');
    } catch {
        return abs.split('?')[0].replace(/\/$/, '');
    }
};

const buildHeaders = () => ({
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
});

const extractPreloadedState = (html) => {
    if (!html) return null;
    const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
};

const flattenInstructionLines = (node, steps = []) => {
    if (!node) return steps;
    if (Array.isArray(node)) {
        for (const entry of node) flattenInstructionLines(entry, steps);
        return steps;
    }
    if (typeof node === 'string') {
        const clean = normalize(node);
        if (clean) steps.push(clean);
        return steps;
    }
    if (typeof node === 'object') {
        const text = normalize(node.text || node.description || node.name);
        if (text) steps.push(text);
        if (node.itemListElement) flattenInstructionLines(node.itemListElement, steps);
        if (node.steps) flattenInstructionLines(node.steps, steps);
    }
    return steps;
};

const getRecipeUrlsFromState = (state) => {
    if (!state) return [];
    const urls = [];
    const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node === 'string') {
            if (/\/recipes\/food\/views\//.test(node)) {
                const abs = toAbs(node, BASE_URL);
                if (abs) urls.push(abs.split('?')[0]);
            }
            return;
        }
        if (typeof node !== 'object') return;
        for (const value of Object.values(node)) walk(value);
    };

    walk(state);
    return uniq(urls);
};

const findNextPageUrl = (html, currentUrl) => {
    const relNext = html.match(/<a[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<a[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i);
    if (relNext?.[1]) {
        return toAbs(relNext[1], currentUrl);
    }

    const ariaNext = html.match(/<a[^>]*aria-label=["'][^"']*next[^"']*["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<a[^>]*href=["']([^"']+)["'][^>]*aria-label=["'][^"']*next[^"']*["']/i);
    if (ariaNext?.[1]) {
        return toAbs(ariaNext[1], currentUrl);
    }

    return null;
};

const pickBestRecipeObject = (state) => {
    const candidates = [];

    const scoreRecipe = (item) => {
        let score = 0;
        if (!item || typeof item !== 'object') return score;
        if (item['@type'] === 'Recipe' || arrify(item['@type']).includes('Recipe')) score += 20;
        if (item.recipeIngredient || item.ingredientGroups) score += 20;
        if (item.recipeInstructions || item.instructions) score += 20;
        if (item.totalTime || item.cookTime || item.prepTime || item.times) score += 10;
        if (item.recipeYield || item.servingSizeInfo) score += 5;
        if (item.aggregateRating) score += 5;
        if (item.hed) score += 10;
        score += Math.min(Object.keys(item).length, 30);
        return score;
    };

    const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== 'object') return;
        const candidateScore = scoreRecipe(node);
        if (candidateScore > 0) {
            candidates.push({ node, score: candidateScore });
        }
        for (const value of Object.values(node)) walk(value);
    };

    walk(state);
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || null;
};

const compactObject = (value) => {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => compactObject(item))
            .filter((item) => item !== null && item !== undefined && item !== '' && item !== 'null');
        return cleaned.length ? cleaned : null;
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (['aspectRatios', '__typename', 'featureFlags', 'aiChatBotConfig'].includes(key)) continue;
            const cleaned = compactObject(child);
            if (cleaned !== null && cleaned !== undefined && cleaned !== '' && cleaned !== 'null') out[key] = cleaned;
        }
        return Object.keys(out).length ? out : null;
    }
    if (typeof value === 'string') {
        const norm = normalize(value);
        return (norm === 'null' || !norm) ? null : norm;
    }
    return value;
};

const toAuthorString = (author) => {
    const names = arrify(author)
        .map((entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') return normalize(entry);
            if (typeof entry === 'object') return normalize(entry.name || entry.displayName);
            return null;
        })
        .filter(Boolean);
    return names.length ? names.join(', ') : null;
};

const mapRecipeRecord = (recipe, detailUrl, recipeType) => {
    let ingredients = arrify(recipe.recipeIngredient)
        .map((value) => normalize(value))
        .filter(Boolean);
    if (!ingredients.length && recipe.ingredientGroups) {
        ingredients = arrify(recipe.ingredientGroups)
            .flatMap((group) => arrify(group.ingredients).map((i) => i.dangerousDescription || i.description))
            .map((value) => normalize(value))
            .filter(Boolean);
    }

    let instructionsList = uniq(flattenInstructionLines(recipe.recipeInstructions));
    if (!instructionsList.length && recipe.instructions) {
        instructionsList = uniq(
            arrify(recipe.instructions)
                .flatMap((group) => arrify(group.steps).map((s) => s.dangerousDescription || s.description))
                .map((value) => normalize(value))
                .filter(Boolean)
        );
    }

    let image = typeof recipe.image === 'string'
        ? recipe.image
        : Array.isArray(recipe.image)
            ? recipe.image.find((entry) => typeof entry === 'string')
            : recipe.image?.url || recipe.image?.['@id'] || null;
    
    if (!image && recipe.lede?.aspectRatios) {
        const aspectRatios = arrify(recipe.lede.aspectRatios);
        image = aspectRatios.find(a => a.name === 'master')?.url || aspectRatios.find(a => a.name === '1:1')?.url || recipe.lede.url || null;
    } else if (!image && recipe.socialPhoto?.url) {
        image = recipe.socialPhoto.url;
    }
    image = cleanImageUrl(image);

    const keywords = Array.isArray(recipe.keywords)
        ? recipe.keywords
        : typeof recipe.keywords === 'string'
            ? recipe.keywords.split(',')
            : [];
            
    let tags = uniq(keywords.map((value) => normalize(value)).filter(Boolean));
    let cuisine = normalize(arrify(recipe.recipeCuisine)[0]);
    let category = normalize(arrify(recipe.recipeCategory)[0]);

    if (recipe.tags && Array.isArray(recipe.tags)) {
        const tagObjects = recipe.tags.filter(t => t && typeof t === 'object');
        if (!tags.length) {
            tags = uniq(tagObjects.map(t => t.name).map(value => normalize(value)).filter(Boolean));
        }
        
        // Better cuisine/category detection
        const cuisineObj = tagObjects.find(t => t.metadata?.contentType === 'cuisine' || t.slug?.includes('cuisine'));
        if (!cuisine && cuisineObj) cuisine = cuisineObj.name;
        
        const catObj = tagObjects.find(t => 
            (t.metadata?.contentType === 'category' || t.name === 'category') && 
            !['Dinner', 'Lunch', 'Breakfast', 'Main', 'Side'].includes(t.name)
        ) || tagObjects.find(t => t.metadata?.contentType === 'category');
        
        if (!category && catObj) category = catObj.name;
    }

    const authors = arrify(recipe.allContributors?.edges).map(e => e.node?.name).filter(Boolean);
    const authorStr = authors.length ? authors.join(', ') : toAuthorString(recipe.author);

    // Clean up raw data to avoid "messy" output
    const rawData = { ...recipe };
    const fieldsToDrop = [
        'body', 'recircRelated', 'recircMostPopular', 'tagCloud', 
        'allContributors', 'aiChatBotConfig', 'featureFlags', 
        'headerProps', 'socialMedia', 'ratingFormSignInURL'
    ];
    fieldsToDrop.forEach(f => delete rawData[f]);
    const dynamic = compactObject(rawData) || {};

    const difficultyVal = recipe.aggregateRating?.ratingValue || recipe.aggregateRating;

    const description = normalize(
        recipe.seoDescription || 
        recipe.dek || 
        recipe.description || 
        recipe.alternativeHeadline || 
        recipe.socialTitle ||
        recipe.lede?.caption
    );

    const record = {
        title: normalize(recipe.hed || recipe.name || recipe.headline) || normalize(detailUrl.split('/').pop()?.replace(/-/g, ' ')),
        author: authorStr,
        description,
        recipe_type: normalize(recipeType),
        ingredients,
        ingredients_count: ingredients.length,
        instructions: instructionsList.join(' | ') || null,
        instructions_list: instructionsList,
        prep_time: normalize(recipe.times?.prepTime || recipe.prepTime),
        cook_time: normalize(recipe.times?.cookTime || recipe.cookTime),
        total_time: normalize(recipe.times?.totalTime || recipe.totalTime),
        servings: normalize(recipe.servingSizeInfo?.description || recipe.recipeYield),
        difficulty: difficultyVal ? `Rated ${difficultyVal}` : null,
        category: normalize(category),
        cuisine: normalize(cuisine),
        tags,
        image_url: image,
        date_published: normalize(recipe.pubDate || recipe.datePublished),
        date_modified: normalize(recipe.dateModified),
        rating_value: recipe.aggregateRating?.ratingValue || recipe.aggregateRating || null,
        rating_count: recipe.reviewsCount || recipe.aggregateRating?.ratingCount || recipe.aggregateRating?.reviewCount || null,
        rating_best: recipe.aggregateRating?.bestRating || null,
        rating_worst: recipe.aggregateRating?.worstRating || null,
        nutrition: compactObject(recipe.nutritionalInfo || recipe.nutrition),
        article_body: normalize(recipe.articleBody),
        alternative_headline: normalize(recipe.alternativeHeadline),
        is_accessible_for_free: recipe.isAccessibleForFree ?? null,
        url: normalize(recipe.url) || detailUrl,
        scraped_at: new Date().toISOString(),
        _source: 'epicurious.com',
    };

    return compactObject(record);
};

const fetchHtml = async (url, proxyConfiguration) => {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_RETRIES + 1; attempt++) {
        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                proxyUrl,
                headers: {
                    ...buildHeaders(),
                    Referer: BASE_URL,
                },
                timeout: { request: 20000 },
                throwHttpErrors: false,
                http2: true,
                retry: { limit: 0 },
            });
            if (response.statusCode >= 400 || !response.body) {
                throw new Error(`Request failed (${response.statusCode})`);
            }
            return response.body;
        } catch (error) {
            lastError = error;
            if (attempt <= REQUEST_RETRIES) {
                const backoffMs = 400 * attempt;
                await Actor.utils.sleep(backoffMs);
            }
        }
    }
    throw lastError;
};

const chunk = (items, size) => {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

const pushInBatches = async (records) => {
    if (!records.length) return;
    for (const batch of chunk(records, DATASET_BATCH_SIZE)) {
        await Dataset.pushData(batch);
    }
};

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrl = 'https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes',
            recipeType = 'vegetarian',
            results_wanted = 20,
            max_pages = 10,
            collectDetails = true,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Math.max(1, Number(results_wanted) || 20);
        const MAX_PAGES = Math.max(1, Number(max_pages) || 10);
        const shouldCollectDetails = Boolean(collectDetails);

        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : undefined;

        const seen = new Set();
        const pushedUrls = new Set();
        let saved = 0;
        let page = 1;
        let listUrl = startUrl;

        while (listUrl && saved < RESULTS_WANTED && page <= MAX_PAGES) {
            log.info(`Page ${page}: collecting from listing`);
            let html;
            try {
                html = await fetchHtml(listUrl, proxyConf);
            } catch (error) {
                log.error(`Failed listing page ${page}: ${error.message}`);
                break;
            }

            const state = extractPreloadedState(html);
            if (!state) {
                log.warning(`No preloaded state found on listing page: ${listUrl}`);
                break;
            }

            const discovered = getRecipeUrlsFromState(state).filter((url) => /\/recipes\/food\/views\//.test(url));
            const urls = [];
            for (const url of discovered) {
                const normalized = normalizeRecipeUrl(url);
                if (normalized && !seen.has(normalized)) {
                    urls.push(normalized);
                    seen.add(normalized);
                }
            }

            const remaining = RESULTS_WANTED - saved;
            const targetUrls = urls.slice(0, remaining);

            if (!shouldCollectDetails) {
                const records = targetUrls.map((url) => ({
                    title: normalize(url.split('/').pop()?.replace(/-/g, ' ')) || 'Recipe',
                    recipe_type: recipeType,
                    url,
                    scraped_at: new Date().toISOString(),
                    _source: 'epicurious.com',
                }));
                const uniqueRecords = records.filter((record) => {
                    const recordUrl = normalizeRecipeUrl(record.url);
                    if (!recordUrl || pushedUrls.has(recordUrl)) return false;
                    pushedUrls.add(recordUrl);
                    return true;
                });
                if (uniqueRecords.length) {
                    await pushInBatches(uniqueRecords);
                    saved += uniqueRecords.length;
                    log.info(`Saved ${uniqueRecords.length} URL items. Total ${saved}/${RESULTS_WANTED}`);
                }
            } else {
                const detailChunks = chunk(targetUrls, DETAIL_CONCURRENCY);
                for (const detailChunk of detailChunks) {
                    if (saved >= RESULTS_WANTED) break;
                    const mapped = await Promise.all(detailChunk.map(async (detailUrl) => {
                        try {
                            const detailHtml = await fetchHtml(`${detailUrl}?output=1`, proxyConf);
                            const detailState = extractPreloadedState(detailHtml);
                            if (!detailState) return null;

                            const recipe = pickBestRecipeObject(detailState);
                            if (!recipe) return null;

                            const item = mapRecipeRecord(recipe, detailUrl, recipeType);
                            const canonicalUrl = normalizeRecipeUrl(item.url || detailUrl);
                            if (!canonicalUrl || pushedUrls.has(canonicalUrl)) return null;
                            item.url = canonicalUrl;
                            pushedUrls.add(canonicalUrl);
                            return item;
                        } catch {
                            return null;
                        }
                    }));

                    const uniqueItems = mapped.filter(Boolean);
                    if (uniqueItems.length) {
                        await pushInBatches(uniqueItems);
                        saved += uniqueItems.length;
                        log.info(`Saved batch: ${uniqueItems.length} items. Total ${saved}/${RESULTS_WANTED}`);
                    }
                }
            }

            if (saved >= RESULTS_WANTED) break;
            listUrl = findNextPageUrl(html, listUrl);
            page += 1;
        }

        log.info(`Extraction complete. Total saved: ${saved}`);
    } finally {
        await Actor.exit();
    }
}

main().catch((error) => {
    log.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
