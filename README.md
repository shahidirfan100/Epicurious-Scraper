# Epicurious Recipes Scraper

Extract complete recipe datasets from Epicurious in a structured, analysis-ready format. Collect titles, ingredients, instructions, times, servings, ratings, publishing metadata, and source links at scale. This actor is ideal for food trend analysis, content planning, and recipe intelligence workflows.

---

## Features

- **Comprehensive recipe records** — Collects rich fields for each recipe, including ingredient lists and step-by-step instructions
- **Category-driven collection** — Start from your preferred Epicurious collection URL and tag records by recipe type
- **Pagination support** — Continues across list pages until your requested result target is reached
- **Flexible output depth** — Choose full detail extraction or URL-only collection for faster runs
- **Internal deduplication** — Automatically removes duplicate recipe URLs in every run

---

## Use Cases

### Recipe Research
Build a high-quality recipe dataset for culinary trend exploration, ingredient pattern analysis, and niche cuisine tracking.

### Editorial Planning
Collect recipe structures, themes, and tags to inform newsletters, blog calendars, and content strategy for food brands.

### Competitive Intelligence
Monitor how recipe styles, timing, and metadata evolve across categories to support product or media decisions.

### Structured Data Pipelines
Feed standardized recipe data into spreadsheets, BI tools, or downstream automations for reporting and enrichment.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | Yes | `https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes` | Epicurious collection or search URL where extraction begins |
| `recipeType` | String | No | `"vegetarian"` | Label added to records for easier categorization |
| `results_wanted` | Integer | No | `20` | Maximum number of recipes to collect |
| `max_pages` | Integer | No | `10` | Safety cap for listing pages |
| `collectDetails` | Boolean | No | `true` | When enabled, collects full recipe details; when disabled, returns URL-focused records |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Proxy configuration (disabled by default) |

---

## Output Data

Each dataset item can contain:

| Field | Type | Description |
|---|---|---|
| `title` | String | Recipe title |
| `author` | String | Recipe author or contributor |
| `description` | String | Recipe summary text |
| `recipe_type` | String | Category label from input |
| `ingredients` | Array | Ingredient lines |
| `ingredients_count` | Number | Number of ingredients |
| `instructions` | String | Instructions joined as a single string |
| `instructions_list` | Array | Step-by-step instruction list |
| `prep_time` | String | Preparation time |
| `cook_time` | String | Cooking time |
| `total_time` | String | Total recipe time |
| `servings` | String | Yield/serving information |
| `difficulty` | String | Difficulty indicator derived from available rating context |
| `category` | String | Recipe category (when available) |
| `cuisine` | String | Cuisine type (when available) |
| `tags` | Array | Recipe tags/keywords |
| `image_url` | String | Main recipe image |
| `date_published` | String | Publish date |
| `date_modified` | String | Last modified date |
| `rating_value` | Number/String | Rating value |
| `rating_count` | Number/String | Rating/review count |
| `rating_best` | Number/String | Best rating value |
| `rating_worst` | Number/String | Worst rating value |
| `nutrition` | Object | Nutrition block (if available) |
| `article_body` | String | Long-form body text (if available) |
| `alternative_headline` | String | Alternate headline text |
| `is_accessible_for_free` | Boolean | Accessibility flag when provided |
| `url` | String | Canonical recipe URL |
| `scraped_at` | String | ISO timestamp of extraction |
| `_source` | String | Source domain identifier |
| `raw` | Object | Additional non-empty source fields for advanced analysis |

---

## Usage Examples

### Basic Collection

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes",
  "recipeType": "vegetarian",
  "results_wanted": 20
}
```

### Vegan Category Collection

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/easy-vegan-recipes",
  "recipeType": "vegan",
  "results_wanted": 40,
  "max_pages": 12,
  "collectDetails": true
}
```

### URL-Only Fast Run

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/vegetarian-recipes",
  "recipeType": "vegetarian",
  "results_wanted": 100,
  "collectDetails": false
}
```

### Proxy Configuration

```json
{
  "proxyConfiguration": {
    "useApifyProxy": false,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "title": "Chicken Tikka Masala",
  "author": "Julie Sahni",
  "description": "A classic and aromatic curry recipe.",
  "recipe_type": "vegetarian",
  "ingredients": [
    "1 cup plain yogurt",
    "2 tablespoons fresh ginger, grated",
    "1 1/2 pounds boneless chicken"
  ],
  "ingredients_count": 3,
  "instructions": "Whisk the marinade. | Coat the chicken and rest. | Simmer sauce and combine.",
  "instructions_list": [
    "Whisk the marinade.",
    "Coat the chicken and rest.",
    "Simmer sauce and combine."
  ],
  "prep_time": "PT20M",
  "cook_time": "PT40M",
  "total_time": "PT1H",
  "servings": "4 servings",
  "tags": ["Indian", "Dinner", "Spicy"],
  "image_url": "https://assets.epicurious.com/photos/example.jpg",
  "date_published": "2024-01-15T10:00:00.000Z",
  "rating_value": 4.8,
  "rating_count": 125,
  "url": "https://www.epicurious.com/recipes/food/views/chicken-tikka-masala-51171400",
  "scraped_at": "2026-02-28T10:30:00.000Z",
  "_source": "epicurious.com"
}
```

---

## Tips for Best Results

### Start With a Focused Collection URL
- Use category-specific pages for cleaner datasets
- Prefer active, frequently updated collections

### Keep Initial Runs Small
- Begin with `results_wanted: 20` for validation
- Increase gradually for production jobs

### Use Proxies for Reliability
- Residential proxy settings help maintain consistent collection quality
- Keep pagination limits realistic for faster completion

---

## Integrations

- **Google Sheets** — Export and review recipe data in spreadsheets
- **Airtable** — Build searchable recipe intelligence bases
- **Make** — Trigger workflows after each run
- **Zapier** — Connect results to business tools
- **Webhooks** — Deliver data to custom systems

### Export Formats

- **JSON** — Best for APIs and apps
- **CSV** — Spreadsheet-friendly format
- **Excel** — Reporting and business analysis
- **XML** — Structured system exchange

---

## Frequently Asked Questions

### How many recipes can I collect?
You can collect as many as available from your chosen pages, constrained by your `results_wanted` and `max_pages` settings.

### Can I run this on multiple categories?
Yes. Schedule separate runs with different `startUrl` and `recipeType` values, then merge datasets.

### Why are some fields empty on certain recipes?
Some source pages do not provide every metadata field. Empty fields are expected when the source lacks that information.

### How can I make runs faster?
Use `collectDetails: false` for URL-focused collection and lower result limits for quick checks.

### Is duplicate prevention available?
Yes. Canonical URL deduplication is enforced internally on every run.

---

## Support

For issues or feature requests, use the support options in your Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection. You are responsible for complying with applicable laws and website terms.
