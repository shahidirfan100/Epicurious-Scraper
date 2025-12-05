# Epicurious Recipes Scraper

> **Production-ready Apify actor** for extracting comprehensive recipe data from Epicurious including ingredients, instructions, timing, and nutritional information. Intelligent data extraction using JSON-LD structured data with HTML parsing fallback for reliability.

## Overview

This actor efficiently scrapes recipes from [Epicurious](https://www.epicurious.com) with support for specialized recipe categories including vegetarian, vegan, gluten-free, and dietary-specific collections. The scraper employs **dual-method data extraction**:

- **Primary**: JSON-LD structured data parsing for accurate, complete recipe metadata
- **Fallback**: Smart HTML parsing ensures data recovery even with markup variations

## Key Features

- 🎯 **Structured Data Extraction** — Prioritizes JSON-LD for reliable, schema-validated recipe data
- 🔄 **Smart Pagination** — Automatically handles multi-page recipe collections with configurable limits
- 📊 **Comprehensive Data** — Captures title, author, ingredients, instructions, timing, servings, images, and more
- 🛡️ **Deduplication** — In-memory duplicate URL detection prevents data redundancy
- ⚡ **Performance Optimized** — Configurable concurrency and timeout handling for reliability
- 🌐 **Proxy Support** — Built-in Apify Proxy integration for residential IP rotation
- 📈 **Scalable** — Handles small test runs and large-scale production collections seamlessly

## Output Data Structure

Each recipe is saved with the following comprehensive schema:

```json
{
  "title": "Roasted Vegetable Medley",
  "author": "Chef Name",
  "description": "A colorful collection of seasonal roasted vegetables...",
  "recipe_type": "vegetarian",
  "ingredients": [
    "2 cups mixed vegetables",
    "3 tablespoons olive oil",
    "Sea salt and pepper to taste"
  ],
  "ingredients_count": 3,
  "instructions": "Preheat oven... | Toss vegetables... | Serve hot...",
  "prep_time": "PT15M",
  "cook_time": "PT30M",
  "total_time": "PT45M",
  "servings": "4",
  "difficulty": "Easy",
  "cuisine": "Mediterranean",
  "category": "Vegetarian Mains",
  "image_url": "https://...",
  "date_published": "2024-01-15",
  "url": "https://www.epicurious.com/recipes/...",
  "scraped_at": "2024-12-05T10:30:00Z"
}
```

## Input Configuration

Configure the actor using these parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startUrl` | String | Vegetarian recipes | Epicurious recipe collection or search URL to begin scraping |
| `recipeType` | String | `vegetarian` | Recipe category (e.g., vegan, gluten-free, dessert) used for tagging |
| `results_wanted` | Integer | `50` | Maximum number of recipes to collect per run |
| `max_pages` | Integer | `10` | Safety limit on pagination to prevent excessive crawling |
| `collectDetails` | Boolean | `true` | Whether to visit individual recipe pages for complete data |
| `dedupe` | Boolean | `true` | Remove duplicate recipe URLs from results |
| `proxyConfiguration` | Object | See below | Proxy settings for requests |

### Proxy Configuration

```json
{
  "useApifyProxy": true,
  "apifyProxyGroups": ["RESIDENTIAL"]
}
```

For best results, use **Residential proxies** to avoid rate limiting and ensure consistent access.

## Usage Examples

### Basic Usage

Scrape the default vegetarian recipes collection:

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes",
  "results_wanted": 25
}
```

### Vegan Recipes

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/easy-vegan-recipes",
  "recipeType": "vegan",
  "results_wanted": 50
}
```

### Desserts with Full Details

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/dessert-recipes",
  "recipeType": "dessert",
  "collectDetails": true,
  "results_wanted": 100
}
```

### Quick Collection (URLs Only)

For rapid metadata collection without detail pages:

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes",
  "collectDetails": false,
  "results_wanted": 200
}
```

## Data Extraction Methods

### 1. JSON-LD Structured Data (Primary)

The actor first attempts to extract recipe data from Schema.org JSON-LD markup:

- `Recipe` type validation
- Complete ingredient arrays
- Step-by-step instructions
- Publication dates and ratings
- Cuisine and category classification

### 2. HTML Parsing Fallback (Robust)

If structured data is incomplete, the actor supplements with intelligent HTML selectors:

- Recipe title extraction from heading tags
- Author/chef name from byline elements
- Ingredient lists from list items and dedicated containers
- Instructions from numbered steps or paragraph sequences
- Image extraction from recipe-associated media
- Timing information from dedicated time elements

## Actor Behavior

### Pagination Logic

1. Crawler visits the starting URL and identifies recipe links
2. Extracts recipe URLs from current page
3. Enqueues URLs for detail extraction (if `collectDetails: true`)
4. Locates "next page" link and continues pagination
5. Stops when reaching `results_wanted` or `max_pages` limit

### Deduplication

When enabled (`dedupe: true`), the actor maintains an in-memory Set of seen recipe URLs to prevent:
- Duplicate processing
- Redundant API calls
- Duplicate dataset entries
- Resource waste

### Error Handling

- Automatic retry logic for failed requests (3 attempts)
- Session pooling for connection stability
- Graceful fallback between data extraction methods
- Detailed logging for debugging

## Performance Considerations

### Recommended Settings

| Use Case | results_wanted | max_pages | collectDetails | Concurrency |
|----------|---|---|---|---|
| Test Run | 10 | 1 | false | 5 |
| Standard Collection | 50 | 10 | true | 5 |
| Large Scale | 500+ | 50 | true | 5 |

### Rate Limiting

- **Default Concurrency**: 5 parallel requests
- **Request Timeout**: 60 seconds per page
- **Retry Attempts**: 3 attempts per failed request
- **Use Residential Proxy** to avoid IP blocks

## Monitoring and Debugging

### Log Levels

The actor provides detailed logging:

```
LIST page 1: https://www.epicurious.com/recipes-menus/...
Found 20 recipe links on page 1
Enqueued 20 recipes for detail extraction
Saved recipe 1/50: Roasted Vegetable Medley
```

### Common Issues

**Few recipes found**
- Verify the collection URL is accessible
- Check pagination settings
- Ensure recipes aren't behind JavaScript rendering

**Incomplete ingredient lists**
- The fallback HTML parsing may be incomplete
- Ensure JSON-LD is available or inspect page source

**Rate limiting or blocks**
- Reduce concurrency to 3
- Enable residential proxy
- Increase request timeouts

## API Endpoints and Data Flow

### Data Sources

- **Primary Source**: https://www.epicurious.com/recipes-menus/
- **Data Format**: HTML + Embedded JSON-LD
- **Authentication**: None required
- **Rate Limits**: Respect robots.txt and Terms of Service

### Output Handling

Results are saved to Apify Dataset with:
- Automatic JSON serialization
- Duplicate prevention via deduplication
- Configurable dataset names and storage
- Export options (JSON, CSV, XML)

## Stealthy Operation

The actor implements multiple anti-detection measures:

- **Session Management**: Rotates session identifiers
- **User-Agent Rotation**: Varied request headers via header-generator
- **Proxy Integration**: Residential IP rotation via Apify Proxy
- **Rate Limiting**: Configurable concurrency and delays
- **Request Timing**: Realistic timeouts and retry intervals

## Sitemap and Collection Discovery

### Supported URL Formats

- Direct recipe collection URLs: `/recipes-menus/*`
- Category-based collections: `/recipes-menus/vegetarian-recipes`
- Search results: `/search?q=vegetarian`
- Individual recipe pages: `/recipes/*/[recipe-name]`

### Dynamic Collection Building

The actor automatically discovers recipes through:
1. Direct link extraction from collection pages
2. Pagination following
3. Dynamic content handling with session management
4. Fallback URL construction

## Production Deployment

### Requirements

- Node.js 22 (or higher)
- Apify Account (for proxy and storage)
- Residential proxy access (recommended)

### Deployment Steps

1. Push code to Apify platform
2. Configure input schema in actor settings
3. Set up proxy configuration
4. Test with sample input
5. Schedule recurring runs if needed

### Scaling Strategy

- Increase `results_wanted` for larger collections
- Use multiple actor runs with different recipe categories
- Combine results from sequential runs
- Store in Apify Dataset for long-term access

## Best Practices

1. **Start Small**: Test with `results_wanted: 10` before scaling
2. **Monitor Logs**: Check actor run logs for extraction issues
3. **Use Proxies**: Residential proxies significantly improve success rates
4. **Handle Errors**: Implement retry logic in downstream processes
5. **Respect Terms**: Ensure compliance with Epicurious Terms of Service
6. **Cache Results**: Use Apify Dataset APIs for efficient data retrieval

## Support & Resources

- [Apify Platform Documentation](https://docs.apify.com)
- [Crawlee Framework Guide](https://crawlee.dev)
- [Schema.org Recipe Specification](https://schema.org/Recipe)

## License

Licensed for use on the Apify platform according to platform terms and conditions.

---

**Version**: 1.0.0 | **Last Updated**: December 2024 | **Maintained by**: Apify Community