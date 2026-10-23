import { Actor, log } from 'apify';
import { Impit } from 'impit';

const DEFAULT_START_URL = 'https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes';
const BASE_URL = 'https://www.epicurious.com';
const RECIPE_PATH = /\/recipes\/food\/views\/[a-z0-9-]+/i;

const PROFILE_LADDER = ['chrome', 'firefox', 'chrome131', 'ios18', 'okhttp5', 'firefox144'];
const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 25000;
const MAX_REQUEST_ATTEMPTS = 4;
const DETAIL_CONCURRENCY = 25;
const DATASET_BATCH_SIZE = 10;

const CUISINE_NAMES = new Set([
    'american', 'italian', 'french', 'mexican', 'thai', 'indian', 'chinese', 'japanese', 'korean',
    'vietnamese', 'mediterranean', 'spanish', 'greek', 'middle eastern', 'moroccan', 'turkish',
    'lebanese', 'israeli', 'german', 'irish', 'british', 'caribbean', 'cuban', 'peruvian', 'brazilian',
    'argentinian', 'southern', 'cajun', 'creole', 'hawaiian', 'filipino', 'indonesian', 'malaysian',
    'singaporean', 'swedish', 'nordic', 'polish', 'russian', 'georgian', 'sri lankan', 'pakistani',
    'ethiopian', 'egyptian', 'persian', 'iranian',
]);

const COURSE_NAMES = new Set([
    'main', 'dinner', 'lunch', 'breakfast', 'brunch', 'snack', 'dessert', 'side', 'appetizer',
    'starter', 'salad', 'soup', 'bread', 'drink', 'cocktail', 'sauce', 'condiment', 'marinade',
]);

const DIFFICULTY_NAMES = new Set(['easy', 'moderate', 'advanced', 'difficult', 'beginner', 'intermediate']);

const NAMED_ENTITIES = {
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ', ndash: '-', mdash: '--',
    lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', copy: '(c)', reg: '(r)',
    trade: '(tm)', eacute: 'e', egrave: 'e', agrave: 'a', ccedil: 'c', uuml: 'u', ouml: 'o',
    auml: 'a', ntilde: 'n', frac12: '1/2', frac14: '1/4', frac34: '3/4', deg: ' degrees',
};

const JSONML_TAGS = new Set([
    'div', 'p', 'a', 'span', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'br', 'figure', 'figcaption', 'img', 'blockquote', 'section', 'article',
]);

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const codePointToString = (code) => {
    try {
        return String.fromCodePoint(code);
    } catch {
        return '';
    }
};

const decodeEntities = (value) => String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePointToString(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => codePointToString(Number.parseInt(decimal, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);

const toText = (value) => {
    if (value === null || value === undefined) return null;

    if (typeof value === 'string') {
        const text = decodeEntities(value)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text || null;
    }

    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
        if (typeof value[0] === 'string' && JSONML_TAGS.has(value[0].toLowerCase())) {
            return toText(value.slice(1));
        }
        if (value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
            return toText(value.join(' '));
        }
        const parts = value.map((entry) => toText(entry)).filter(Boolean);
        return parts.length ? parts.join(' ').replace(/\s+/g, ' ').trim() : null;
    }

    if (typeof value === 'object') {
        for (const key of ['text', 'dangerousDescription', 'description', 'name', 'hed', 'dangerousHed', 'title', 'value']) {
            const text = toText(value[key]);
            if (text) return text;
        }
    }

    return null;
};

const asArray = (value) => {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
};

const firstFilled = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        return value;
    }
    return null;
};

const unique = (values) => {
    const seen = new Set();
    const result = [];

    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = typeof value === 'string' ? value.trim() : value;
        if (text === '') continue;

        const key = typeof text === 'string' ? text.toLowerCase() : JSON.stringify(text);
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(text);
    }

    return result;
};

const titleCase = (value) => {
    const text = toText(value);
    if (!text) return null;
    return text.replace(/(^|\s)([a-z])/g, (_, space, letter) => `${space}${letter.toUpperCase()}`);
};

const toStringList = (value) => {
    const entries = Array.isArray(value) ? value.flat(3) : [value];
    return unique(entries.map((entry) => toText(entry)).filter(Boolean));
};

const toStringTags = (value) => unique(toStringList(value)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const typeNames = (value) => asArray(value).map((entry) => String(entry).toLowerCase());

const hasType = (node, wanted) => isPlainObject(node) && typeNames(node['@type']).includes(wanted.toLowerCase());

// Hydration payloads can contain "};" inside strings, so a regex can cut them short.
const scanBalancedJson = (text, startIndex) => {
    const opening = text[startIndex];
    const stack = [opening === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;

    for (let index = startIndex + 1; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}' || char === ']') {
            const expected = stack.pop();
            if (expected !== char) return null;
            if (stack.length === 0) return text.slice(startIndex, index + 1);
        }
    }

    return null;
};

const extractAssignedJson = (html, name) => {
    const markers = [`window.${name}`, `window["${name}"]`, `window['${name}']`];

    for (const marker of markers) {
        let searchFrom = 0;

        while (searchFrom < html.length) {
            const markerIndex = html.indexOf(marker, searchFrom);
            if (markerIndex === -1) break;
            searchFrom = markerIndex + marker.length;

            const equalsIndex = html.indexOf('=', searchFrom);
            if (equalsIndex === -1 || equalsIndex - markerIndex > 200) continue;

            let start = equalsIndex + 1;
            while (start < html.length && /\s/.test(html[start])) start += 1;
            if (html[start] !== '{' && html[start] !== '[') continue;

            const json = scanBalancedJson(html, start);
            if (!json) continue;

            try {
                return JSON.parse(json);
            } catch {
                continue;
            }
        }
    }

    return null;
};

const extractHydrationState = (html) => {
    for (const name of ['__PRELOADED_STATE__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__NUXT__']) {
        const state = extractAssignedJson(html, name);
        if (state) return state;
    }

    const nextData = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextData?.[1]) {
        try {
            return JSON.parse(nextData[1]);
        } catch {
            return null;
        }
    }

    return null;
};

const collectJsonLdNodes = (value, output) => {
    if (Array.isArray(value)) {
        value.forEach((entry) => collectJsonLdNodes(entry, output));
        return output;
    }

    if (!isPlainObject(value)) return output;

    output.push(value);
    if (value['@graph']) collectJsonLdNodes(value['@graph'], output);
    if (value.mainEntity) collectJsonLdNodes(value.mainEntity, output);
    if (value.itemListElement) collectJsonLdNodes(value.itemListElement, output);

    return output;
};

const extractJsonLdNodes = (html) => {
    const nodes = [];
    const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

    for (const block of blocks) {
        try {
            collectJsonLdNodes(JSON.parse(block[1]), nodes);
        } catch {
            continue;
        }
    }

    return nodes;
};

const findRecipeNodes = (nodes) => nodes.filter((node) => hasType(node, 'Recipe'));

const extractRecipeFromState = (state) => {
    const direct = state?.transformed?.recipe;
    if (isPlainObject(direct) && (direct.hed || direct.dangerousHed) && (direct.ingredientGroups || direct.ingredients)) {
        return direct;
    }

    let best = null;
    let bestScore = 0;

    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 12) return;

        if (Array.isArray(node)) {
            node.forEach((entry) => visit(entry, depth + 1));
            return;
        }

        const hasHeading = Boolean(node.hed || node.dangerousHed);
        if (hasHeading) {
            let score = 2;
            if (node.ingredientGroups || node.ingredients) score += 3;
            if (node.instructions) score += 3;
            if (node.times || node.servingSizeInfo) score += 1;
            if (node.aggregateRating !== undefined || node.reviewsCount !== undefined) score += 1;
            if (node.tags) score += 1;
            if (node.aiChatBotConfig) score -= 2;

            if (score > bestScore) {
                best = node;
                bestScore = score;
            }
        }

        Object.values(node).forEach((entry) => visit(entry, depth + 1));
    };

    visit(state, 0);
    return bestScore >= 5 ? best : null;
};

const normalizeImageUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;

    try {
        const url = new URL(value, BASE_URL);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
};

const extractImageUrl = (value, depth = 0) => {
    if (!value || depth > 6) return null;

    if (typeof value === 'string') return normalizeImageUrl(value);

    if (Array.isArray(value)) {
        for (const entry of value) {
            const url = extractImageUrl(entry, depth + 1);
            if (url) return url;
        }
        return null;
    }

    if (!isPlainObject(value)) return null;

    for (const key of ['url', 'src', 'href']) {
        if (typeof value[key] === 'string') {
            const url = normalizeImageUrl(value[key]);
            if (url) return url;
        }
    }

    for (const key of ['master', 'lg', 'md', 'sm', 'original', 'sources', 'segmentedSources', 'aspectRatios', 'edges', 'node', 'image']) {
        if (!(key in value)) continue;
        const url = extractImageUrl(value[key], depth + 1);
        if (url) return url;
    }

    for (const entry of Object.values(value)) {
        const url = extractImageUrl(entry, depth + 1);
        if (url) return url;
    }

    return null;
};

const isEpicuriousHost = (hostname) => hostname === 'epicurious.com' || hostname.endsWith('.epicurious.com');

const canonicalRecipeUrl = (value, base = BASE_URL) => {
    if (typeof value !== 'string' || !value.trim()) return null;

    try {
        const url = new URL(value, base);
        if (!isEpicuriousHost(url.hostname) || !RECIPE_PATH.test(url.pathname)) return null;
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
        return null;
    }
};

const isRecipeUrl = (value) => Boolean(canonicalRecipeUrl(value));

const normalizeStartUrl = (value) => {
    const supplied = typeof value === 'string' ? value.trim() : '';
    const raw = supplied || DEFAULT_START_URL;

    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`startUrl is not a valid URL: ${raw}`);
    }

    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || !isEpicuriousHost(url.hostname)) {
        throw new Error('startUrl must be an Epicurious URL.');
    }

    url.hash = '';
    return url.href;
};

const normalizePageUrl = (value, base) => {
    if (typeof value !== 'string' || !value.trim()) return null;

    try {
        const url = new URL(value, base);
        if (!isEpicuriousHost(url.hostname)) return null;
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
};

const withPageParam = (value, page) => {
    try {
        const url = new URL(value);
        url.searchParams.set('page', String(page));
        return url.href;
    } catch {
        return null;
    }
};

const normalizeListingRecord = (item, baseUrl) => {
    if (typeof item === 'string') {
        const url = canonicalRecipeUrl(item, baseUrl);
        return url ? { url, title: null, description: null, image_url: null } : null;
    }

    if (!isPlainObject(item)) return null;

    const rawUrl = firstFilled(item.ctaHref, item.url, item.contentURL, item.link, item.href, item.item?.url, item.item);
    const url = canonicalRecipeUrl(rawUrl, baseUrl);
    if (!url) return null;

    return {
        url,
        title: toText(firstFilled(item.dangerousHed, item.hed, item.name, item.title, item.headline, item.item?.name)),
        description: toText(firstFilled(item.dangerousDek, item.dek, item.description, item.summary, item.item?.description)),
        image_url: extractImageUrl(firstFilled(item.image, item.socialPhoto, item.thumbnailUrl, item.item?.image)),
    };
};

const dedupeListingRecords = (records) => {
    const seen = new Set();
    const result = [];

    for (const record of records) {
        if (!record?.url || seen.has(record.url)) continue;
        seen.add(record.url);
        result.push(record);
    }

    return result;
};

const getStateListingItems = (state) => {
    const transformed = state?.transformed;
    if (!transformed) return [];

    const candidates = [
        transformed.gallery?.items,
        transformed.tag?.items,
        transformed.search?.items?.flatMap((group) => asArray(group?.items)),
        transformed.collection?.items,
        transformed.channel?.items,
        transformed.results?.items,
    ];

    for (const candidate of candidates) {
        const items = asArray(candidate);
        if (items.length) return items;
    }

    const found = [];
    const seen = new Set();

    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 12 || found.length >= 1000) return;

        if (Array.isArray(node)) {
            node.forEach((entry) => visit(entry, depth + 1));
            return;
        }

        const rawUrl = firstFilled(node.ctaHref, node.url, node.contentURL, node.link, node.href);
        const url = canonicalRecipeUrl(rawUrl);
        if (url && !seen.has(url)) {
            seen.add(url);
            found.push(node);
        }

        Object.values(node).forEach((entry) => visit(entry, depth + 1));
    };

    visit(state, 0);
    return found;
};

const getJsonLdListingItems = (nodes) => {
    const records = [];

    for (const node of nodes) {
        if (!hasType(node, 'ItemList')) continue;
        for (const entry of asArray(node.itemListElement)) {
            const item = firstFilled(entry?.item, entry);
            const itemUrl = typeof item === 'string' ? item : firstFilled(item?.url, entry?.url);
            const url = canonicalRecipeUrl(itemUrl);
            if (!url) continue;

            records.push({
                url,
                title: toText(firstFilled(item?.name, entry?.name)),
                description: toText(firstFilled(item?.description, entry?.description)),
                image_url: extractImageUrl(firstFilled(item?.image, entry?.image)),
            });
        }
    }

    return records;
};

const getAnchorListingRecords = (html, baseUrl) => {
    const records = [];
    const anchorPattern = /<a\b[^>]*href=["']([^"']*\/recipes\/food\/views\/[^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

    for (const match of html.matchAll(anchorPattern)) {
        const url = canonicalRecipeUrl(match[1], baseUrl);
        if (!url) continue;
        records.push({ url, title: toText(match[2]), description: null, image_url: null });
    }

    return records;
};

const extractListingRecords = (state, jsonLdNodes, html, baseUrl) => {
    const fromState = getStateListingItems(state).map((item) => normalizeListingRecord(item, baseUrl));
    const fromJsonLd = getJsonLdListingItems(jsonLdNodes);
    const fromAnchors = getAnchorListingRecords(html, baseUrl);

    for (const source of [fromState, fromJsonLd, fromAnchors]) {
        const records = dedupeListingRecords(source.filter(Boolean));
        if (records.length) return records;
    }

    return [];
};

const findNextPageUrl = (state, html, currentUrl, page, maxPages) => {
    const searchGroups = asArray(state?.transformed?.search?.items);
    const explicit = firstFilled(
        state?.transformed?.tag?.nextPageURL,
        state?.head?.nextPage,
        state?.['head.nextPage'],
        state?.transformed?.search?.nextPageURL,
        state?.transformed?.gallery?.nextPageURL,
        ...searchGroups.map((group) => group?.nextPageURL),
    );

    if (explicit) {
        const next = normalizePageUrl(explicit, currentUrl);
        if (next && next !== currentUrl) return next;
    }

    const relNext = html.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i)
        || html.match(/<a[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i)
        || html.match(/<a[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i);

    if (relNext?.[1]) {
        const next = normalizePageUrl(relNext[1], currentUrl);
        if (next && next !== currentUrl) return next;
    }

    if (page < maxPages && !isRecipeUrl(currentUrl)) {
        return withPageParam(currentUrl, page + 1);
    }

    return null;
};

const flattenHowTo = (value) => {
    const steps = [];

    const visit = (node) => {
        if (!node) return;

        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }

        if (typeof node === 'string') {
            const text = toText(node);
            if (text) steps.push(text);
            return;
        }

        if (!isPlainObject(node)) return;

        if (node.itemListElement) {
            visit(node.itemListElement);
            return;
        }

        const text = toText(firstFilled(node.text, node.description, node.name));
        if (text) steps.push(text);
    };

    visit(value);
    return unique(steps);
};

const getIngredients = (jsonLd, stateRecipe) => {
    const fromJsonLd = toStringList(jsonLd.recipeIngredient || jsonLd.ingredients);
    if (fromJsonLd.length) return fromJsonLd;

    const fromGroups = asArray(stateRecipe?.ingredientGroups).flatMap((group) => asArray(group?.ingredients).map((ingredient) => (
        toText(firstFilled(ingredient?.dangerousDescription, ingredient?.description, ingredient?.descriptionJsonMl, ingredient))
    ))).filter(Boolean);

    if (fromGroups.length) return unique(fromGroups);

    return toStringList(stateRecipe?.ingredients);
};

const getInstructions = (jsonLd, stateRecipe) => {
    const fromJsonLd = flattenHowTo(jsonLd.recipeInstructions);
    if (fromJsonLd.length) return fromJsonLd;

    const fromGroups = asArray(stateRecipe?.instructions).flatMap((group) => asArray(group?.steps).map((step) => (
        toText(firstFilled(step?.dangerousDescription, step?.description, step?.text, step))
    ))).filter(Boolean);

    if (fromGroups.length) return unique(fromGroups);

    return toStringList(stateRecipe?.instructions);
};

const findTagName = (tags, allowed) => tags.find((tag) => allowed.has(tag.toLowerCase())) || null;

const getStateTagNames = (stateRecipe) => unique(asArray(stateRecipe?.tags).map((tag) => toText(tag?.name)).filter(Boolean));

const getAuthorNames = (jsonLd, stateRecipe) => {
    const fromJsonLd = asArray(jsonLd.author).map((author) => toText(firstFilled(author?.name, author)));
    const fromState = asArray(stateRecipe?.allContributors?.edges).map((edge) => toText(edge?.node?.name));
    return unique([...fromJsonLd, ...fromState].filter(Boolean));
};

const getMetaContent = (html, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return decodeEntities(match[1]).trim();
    }

    return null;
};

const stripTitleSuffix = (value) => {
    const text = toText(value);
    if (!text) return null;
    return text.replace(/\s*\|\s*Epicurious\s*$/i, '').trim() || null;
};

const compactObject = (value) => {
    if (value === null || value === undefined) return null;

    if (Array.isArray(value)) {
        const cleaned = value
            .map((entry) => compactObject(entry))
            .filter((entry) => entry !== null && entry !== undefined && entry !== '');
        return cleaned.length ? cleaned : null;
    }

    if (typeof value === 'object') {
        const output = {};

        for (const [key, entry] of Object.entries(value)) {
            if (['__typename', 'featureFlags', 'aiChatBotConfig'].includes(key)) continue;
            const cleaned = compactObject(entry);
            if (cleaned !== null && cleaned !== undefined && cleaned !== '') output[key] = cleaned;
        }

        return Object.keys(output).length ? output : null;
    }

    if (typeof value === 'string') return toText(value);

    return value;
};

const mapRecipeRecord = ({ jsonLd, stateRecipe, listingRecord, pageUrl, html, recipeType }) => {
    const ld = jsonLd || {};
    const state = stateRecipe || {};
    const ingredients = getIngredients(ld, state);
    const instructions = getInstructions(ld, state);
    const stateTags = getStateTagNames(state);
    const tags = unique([...toStringTags(ld.keywords), ...stateTags]);
    const author = getAuthorNames(ld, state).join(', ') || null;

    const description = toText(firstFilled(
        ld.description,
        state.dek,
        state.seoDescription,
        state.description,
        ld.alternativeHeadline,
        listingRecord?.description,
    ));

    const title = stripTitleSuffix(firstFilled(
        ld.name,
        ld.headline,
        state.hed,
        state.socialTitle,
        listingRecord?.title,
        getMetaContent(html, 'og:title'),
    ));

    const imageUrl = extractImageUrl(firstFilled(
        ld.image,
        ld.thumbnailUrl,
        state.lede,
        state.socialPhoto,
        listingRecord?.image_url,
        getMetaContent(html, 'og:image'),
    ));

    const rating = isPlainObject(ld.aggregateRating)
        ? ld.aggregateRating
        : { ratingValue: ld.aggregateRating };
    const stateRating = isPlainObject(state.aggregateRating) ? state.aggregateRating : {};
    const stateRatingValue = isPlainObject(state.aggregateRating) ? null : state.aggregateRating;
    const category = firstFilled(
        toStringTags(ld.recipeCategory)[0],
        findTagName(tags, COURSE_NAMES),
    );
    const cuisine = firstFilled(
        toStringTags(ld.recipeCuisine)[0],
        findTagName(tags, CUISINE_NAMES),
    );
    const difficulty = findTagName(tags, DIFFICULTY_NAMES);
    const nutrition = firstFilled(ld.nutrition, state.nutritionalInfo);

    const record = {
        title,
        author,
        description,
        recipe_type: toText(recipeType),
        ingredients,
        ingredients_count: ingredients.length,
        instructions: instructions.length ? instructions.join(' | ') : null,
        instructions_list: instructions,
        prep_time: toText(firstFilled(ld.prepTime, state.times?.prepTime, state.prepTime)),
        cook_time: toText(firstFilled(ld.cookTime, state.times?.cookTime, state.cookTime)),
        total_time: toText(firstFilled(ld.totalTime, state.times?.totalTime, state.totalTime)),
        servings: toText(firstFilled(ld.recipeYield, state.servingSizeInfo?.description, state.recipeYield)),
        difficulty: titleCase(difficulty),
        category: titleCase(category),
        cuisine: titleCase(cuisine),
        tags,
        image_url: imageUrl,
        date_published: toText(firstFilled(ld.datePublished, state.pubDate, state.publishInfo?.firstPublished)),
        date_modified: toText(firstFilled(ld.dateModified, state.revisionInfo?.updatedAt)),
        rating_value: firstFilled(rating.ratingValue, stateRating.ratingValue, stateRatingValue),
        rating_count: firstFilled(rating.ratingCount, rating.reviewCount, stateRating.ratingCount, state.reviewsCount),
        rating_best: firstFilled(rating.bestRating),
        rating_worst: firstFilled(rating.worstRating),
        nutrition: isPlainObject(nutrition) ? compactObject(nutrition) : toText(nutrition),
        article_body: toText(firstFilled(ld.articleBody, state.articleBody, state.body)),
        alternative_headline: toText(firstFilled(ld.alternativeHeadline, state.alternativeHeadline, state.socialTitle)),
        is_accessible_for_free: firstFilled(ld.isAccessibleForFree, state.isAccessibleForFree),
        url: canonicalRecipeUrl(firstFilled(ld.url, pageUrl), pageUrl),
        scraped_at: new Date().toISOString(),
        _source: 'epicurious.com',
    };

    return compactObject(record);
};

const parseRecipePage = (html, pageUrl, listingRecord, recipeType) => {
    const jsonLdNodes = extractJsonLdNodes(html);
    const jsonLdRecipe = findRecipeNodes(jsonLdNodes)[0];
    const state = extractHydrationState(html);
    const stateRecipe = extractRecipeFromState(state);

    if (jsonLdRecipe || stateRecipe) {
        return mapRecipeRecord({ jsonLd: jsonLdRecipe, stateRecipe, listingRecord, pageUrl, html, recipeType });
    }

    const title = stripTitleSuffix(getMetaContent(html, 'og:title') || getMetaContent(html, 'twitter:title'));
    if (!title) return null;

    return compactObject({
        title,
        description: toText(getMetaContent(html, 'og:description') || getMetaContent(html, 'description')),
        recipe_type: toText(recipeType),
        image_url: normalizeImageUrl(getMetaContent(html, 'og:image')),
        date_published: toText(getMetaContent(html, 'article:published_time')),
        url: canonicalRecipeUrl(pageUrl),
        scraped_at: new Date().toISOString(),
        _source: 'epicurious.com',
    });
};

const fallbackRecord = (listingRecord, recipeType) => compactObject({
    title: listingRecord?.title || (listingRecord?.url ? titleCase(listingRecord.url.split('/').pop()?.replace(/-/g, ' ')) : null),
    description: listingRecord?.description,
    recipe_type: toText(recipeType),
    image_url: listingRecord?.image_url,
    url: listingRecord?.url,
    scraped_at: new Date().toISOString(),
    _source: 'epicurious.com',
});

const chunk = (items, size) => {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

const looksBlocked = (html) => {
    const sample = html.slice(0, 200000).toLowerCase();
    return sample.includes('cf-chl')
        || sample.includes('just a moment...')
        || sample.includes('attention required! | cloudflare')
        || sample.includes('access denied')
        || sample.includes('px-captcha');
};

const retryAfterMs = (response) => {
    const header = response?.headers?.get('retry-after');
    if (!header) return null;

    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10000);

    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10000);

    return null;
};

const shortUrl = (value) => {
    try {
        return new URL(value).pathname;
    } catch {
        return value;
    }
};

const run = async () => {
    const input = (await Actor.getInput()) || {};
    const startUrl = normalizeStartUrl(input.startUrl);
    const resultsWanted = Math.max(1, Number.parseInt(input.results_wanted, 10) || 20);
    const maxPages = Math.max(1, Number.parseInt(input.max_pages, 10) || 10);
    const collectDetails = input.collectDetails !== false;
    const { recipeType } = input;

    const proxyConfiguration = input.proxyConfiguration && Object.keys(input.proxyConfiguration).length
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

    const clients = new Map();
    const profilesUsed = new Set();
    let profileIndex = 0;
    let proxySession = null;
    let proxySessionCounter = 0;
    let proxyUrl = null;

    const rotateIdentity = () => {
        profileIndex += 1;
        proxySession = null;
        proxyUrl = null;
    };

    const resolveProxyUrl = async () => {
        if (!proxyConfiguration) return null;
        if (proxyUrl) return proxyUrl;

        proxySession ??= `epi-${Date.now()}-${proxySessionCounter += 1}`;
        proxyUrl = await proxyConfiguration.newUrl(proxySession);
        return proxyUrl;
    };

    const getClient = async (profile) => {
        const activeProxyUrl = await resolveProxyUrl();
        const key = `${profile}|${activeProxyUrl || 'direct'}`;

        if (!clients.has(key)) {
            clients.set(key, new Impit({
                browser: profile,
                ...(activeProxyUrl ? { proxyUrl: activeProxyUrl } : {}),
                timeout: REQUEST_TIMEOUT_MS,
            }));
        }

        return clients.get(key);
    };

    const fetchPage = async (url, { referer } = {}) => {
        let lastError = new Error(`Request failed for ${shortUrl(url)}`);

        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
            const profile = PROFILE_LADDER[profileIndex % PROFILE_LADDER.length];
            let waitMs = Math.min(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400), 8000);

            try {
                const client = await getClient(profile);
                const response = await client.fetch(url, {
                    headers: referer ? { referer } : undefined,
                    timeout: REQUEST_TIMEOUT_MS,
                });
                const html = await response.text();

                if (response.ok && !looksBlocked(html)) {
                    profilesUsed.add(profile);
                    return { html, finalUrl: response.url || url, profile };
                }

                if (response.ok) {
                    lastError = new Error('Challenge page returned');
                } else {
                    lastError = new Error(`HTTP ${response.status}`);
                    waitMs = retryAfterMs(response) ?? waitMs;
                    if (!RETRYABLE_STATUS.has(response.status)) break;
                }
            } catch (error) {
                lastError = error;
            }

            if (attempt < MAX_REQUEST_ATTEMPTS) {
                log.warning(`Request retry ${attempt}/${MAX_REQUEST_ATTEMPTS - 1} for ${shortUrl(url)}: ${lastError.message}`);
                await sleep(waitMs);
                rotateIdentity();
            }
        }

        throw lastError;
    };

    log.info(`Start run | source=${startUrl} | target=${resultsWanted} | maxPages=${maxPages} | details=${collectDetails}`);

    const pushedUrls = new Set();
    const visitedListUrls = new Set();
    let saved = 0;
    let pagesProcessed = 0;
    let detailAttempts = 0;
    let detailSuccesses = 0;
    let fallbackCount = 0;
    let lastDetailError = null;
    let stopReason = 'no more pages';
    let listUrl = startUrl;
    let page = 1;

    while (listUrl && saved < resultsWanted && page <= maxPages) {
        visitedListUrls.add(listUrl);

        let listing;
        try {
            listing = await fetchPage(listUrl, { referer: BASE_URL });
        } catch (error) {
            throw new Error(`Listing request failed for ${shortUrl(listUrl)}: ${error.message}`);
        }

        pagesProcessed += 1;
        const state = extractHydrationState(listing.html);
        const jsonLdNodes = extractJsonLdNodes(listing.html);
        const singleRecipe = isRecipeUrl(listing.finalUrl) && findRecipeNodes(jsonLdNodes).length > 0;

        let listingRecords;
        if (singleRecipe) {
            listingRecords = [{
                url: canonicalRecipeUrl(listing.finalUrl),
                title: stripTitleSuffix(firstFilled(findRecipeNodes(jsonLdNodes)[0]?.name, getMetaContent(listing.html, 'og:title'))),
                description: toText(firstFilled(findRecipeNodes(jsonLdNodes)[0]?.description, getMetaContent(listing.html, 'og:description'))),
                image_url: extractImageUrl(firstFilled(findRecipeNodes(jsonLdNodes)[0]?.image, getMetaContent(listing.html, 'og:image'))),
            }];
        } else {
            listingRecords = extractListingRecords(state, jsonLdNodes, listing.html, listing.finalUrl);
        }

        const newRecords = listingRecords.filter((record) => record.url && !pushedUrls.has(record.url));
        if (!newRecords.length) {
            log.warning(`No new recipes found on page ${page}: ${shortUrl(listing.finalUrl)}`);
            if (pagesProcessed === 1 && listingRecords.length === 0) {
                stopReason = 'no recipes found';
            }
            break;
        }

        if (!collectDetails) {
            const records = newRecords.slice(0, resultsWanted - saved).map((record) => compactObject({
                title: record.title,
                description: record.description,
                recipe_type: toText(recipeType),
                image_url: record.image_url,
                url: record.url,
                scraped_at: new Date().toISOString(),
                _source: 'epicurious.com',
            }));

            for (const batch of chunk(records, DATASET_BATCH_SIZE)) {
                await Actor.pushData(batch);
                saved += batch.length;
                batch.forEach((record) => pushedUrls.add(record.url));
            }

            log.info(`Saved ${records.length} URL records. Total ${saved}/${resultsWanted}`);
        } else {
            const detailQueue = newRecords.slice(0, resultsWanted - saved);

            for (const detailChunk of chunk(detailQueue, DETAIL_CONCURRENCY)) {
                // eslint-disable-next-line no-loop-func
                const records = await Promise.all(detailChunk.map(async (record) => {
                    detailAttempts += 1;

                    try {
                        const detailPage = await fetchPage(record.url, { referer: listing.finalUrl });
                        const parsed = parseRecipePage(detailPage.html, detailPage.finalUrl, record, recipeType);

                        if (!parsed) {
                            fallbackCount += 1;
                            log.warning(`No recipe data found at ${shortUrl(record.url)}`);
                            return fallbackRecord(record, recipeType);
                        }

                        detailSuccesses += 1;
                        return parsed;
                    } catch (error) {
                        fallbackCount += 1;
                        lastDetailError = error;
                        log.warning(`Detail request failed for ${shortUrl(record.url)}: ${error.message}`);
                        return fallbackRecord(record, recipeType);
                    }
                }));

                const uniqueRecords = records.filter((record) => {
                    if (!record?.url || pushedUrls.has(record.url)) return false;
                    pushedUrls.add(record.url);
                    return true;
                });

                for (const batch of chunk(uniqueRecords, DATASET_BATCH_SIZE)) {
                    await Actor.pushData(batch);
                    saved += batch.length;
                }

                if (uniqueRecords.length) {
                    log.info(`Saved ${uniqueRecords.length} recipes. Total ${saved}/${resultsWanted}`);
                }

                if (saved >= resultsWanted) break;
            }

            if (saved >= resultsWanted) {
                stopReason = 'target reached';
                break;
            }
        }

        if (saved >= resultsWanted) {
            stopReason = 'target reached';
            break;
        }

        if (page >= maxPages) {
            stopReason = 'max pages reached';
            break;
        }

        const nextUrl = findNextPageUrl(state, listing.html, listing.finalUrl, page, maxPages);
        if (!nextUrl || nextUrl === listUrl || visitedListUrls.has(nextUrl)) {
            stopReason = 'no more pages';
            break;
        }

        listUrl = nextUrl;
        page += 1;
    }

    if (collectDetails && detailAttempts > 0 && detailSuccesses === 0) {
        throw new Error(`No recipe details could be parsed from ${detailAttempts} pages. Last error: ${lastDetailError?.message || 'none'}`);
    }

    if (saved === 0) {
        throw new Error(`No recipes were saved from ${startUrl}. The source may have changed.`);
    }

    log.info(`Done | saved=${saved} | pages=${pagesProcessed} | detail_fallbacks=${fallbackCount} | profiles=${[...profilesUsed].join(',') || 'none'} | stop=${stopReason}`);
};

await Actor.init();

let exitCode = 0;
try {
    await run();
} catch (error) {
    exitCode = 1;
    log.error(`Run failed: ${error.message}`);
}

await Actor.exit({ exitCode });
