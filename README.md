## What does Epicurious Recipes Scraper do?

Epicurious Recipes Scraper collects recipe data from Epicurious collection pages, ingredient pages, and individual recipe URLs. Start with a page such as `our-favorite-vegetarian-recipes` or `ingredient/banana`, set a result limit, and download a structured dataset of recipe titles, ingredients, instructions, times, servings, ratings, tags, and source links.

The Actor is built for recipe research, food content planning, menu development, nutrition analysis, and AI datasets that need clean recipe records instead of copy-pasted text from web pages.

## Why use Epicurious Recipes Scraper?

- **Recipe datasets without manual work** - Collect hundreds of recipe records with consistent field names and canonical URLs.
- **Broad source coverage** - Start from editorial collections, ingredient pages, or a single recipe.
- **Control over detail depth** - Collect full ingredients and instructions, or switch to a faster URL-only run.
- **Ready for repeat runs** - Schedule the Actor to refresh a recipe collection, monitor new additions, or build a data pipeline.
- **Export and integration support** - Download JSON, CSV, Excel, or XML, or send results to Google Sheets, webhooks, Make, Zapier, or your own API.
- **Useful filtering fields** - Separate recipes by `recipe_type`, `category`, `cuisine`, `difficulty`, tags, and ratings after collection.

## What data can you extract from Epicurious?

| Field | Description |
|-------|-------------|
| `title` | Recipe name as published on Epicurious |
| `author` | Recipe author or contributor names |
| `description` | Short recipe summary |
| `ingredients` | Full ingredient line list |
| `instructions_list` | Step-by-step cooking instructions |
| `prep_time`, `cook_time`, `total_time` | Timing values published by the source |
| `servings` | Yield or serving information |
| `difficulty` | Difficulty tag such as Easy or Moderate |
| `category`, `cuisine` | Course and cuisine labels when available |
| `rating_value`, `rating_count` | Rating average and number of ratings |
| `image_url` | Main recipe image |
| `url` | Canonical Epicurious recipe URL |

The dataset also includes tags, nutrition data, article text, publish dates, and source metadata when Epicurious provides them.

## How to use Epicurious Recipes Scraper

1. Open the Actor in Apify Console.
2. Paste an Epicurious collection, ingredient, or recipe URL into `startUrl`.
3. Set `results_wanted` and, for listing pages, `max_pages`.
4. Leave `collectDetails` enabled for full recipes, or disable it for a quick URL list.
5. Run the Actor and open the dataset to review, filter, or export the results.

For a first run, use the prefilled vegetarian collection and a limit of 20 recipes. Increase the limit and page count after you confirm the output shape.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes` | Epicurious collection, ingredient, or recipe URL |
| `recipeType` | String | No | - | Optional label stored as `recipe_type`, such as vegetarian, vegan, or dessert |
| `collectDetails` | Boolean | No | `true` | Visit each recipe page for ingredients and instructions. Disable for titles and URLs only |
| `results_wanted` | Integer | No | `20` | Stop after saving this many recipes |
| `max_pages` | Integer | No | `10` | Pagination limit for collection and ingredient pages |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional Apify Proxy settings for larger or repeat runs |

`startUrl` accepts collection pages, ingredient pages, and individual recipe URLs. Keyword search pages are not used as an input source; use an ingredient page or a themed collection instead.

## Output Data

Fields without a source value are omitted from the record.

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Recipe title |
| `author` | String | Author or contributor names |
| `description` | String | Recipe summary |
| `recipe_type` | String | Label from the `recipeType` input |
| `ingredients` | Array | Ingredient lines |
| `ingredients_count` | Number | Number of ingredient lines |
| `instructions` | String | Instructions joined with ` \| ` |
| `instructions_list` | Array | Instruction steps |
| `prep_time` | String | Prep time as published |
| `cook_time` | String | Cook time as published |
| `total_time` | String | Total time as published |
| `servings` | String | Yield or serving information |
| `difficulty` | String | Difficulty tag, such as Easy or Moderate |
| `category` | String | Course or category, such as Main or Dessert |
| `cuisine` | String | Cuisine when available |
| `tags` | Array | Keywords and recipe tags |
| `image_url` | String | Main image URL |
| `date_published` | String | Publish date |
| `date_modified` | String | Last modified date |
| `rating_value` | Number | Average rating |
| `rating_count` | Number | Rating or review count |
| `rating_best` | Number | Best possible rating |
| `rating_worst` | Number | Worst possible rating |
| `nutrition` | Object | Nutrition block when present |
| `article_body` | String | Long-form recipe article |
| `alternative_headline` | String | Alternate headline |
| `is_accessible_for_free` | Boolean | Free-access flag |
| `url` | String | Canonical recipe URL |
| `scraped_at` | String | ISO timestamp |
| `_source` | String | `epicurious.com` |

## Usage Examples

### Collect a vegetarian recipe collection

Use a themed collection to build a recipe dataset with full details.

```json
{
  "startUrl": "https://www.epicurious.com/recipes-menus/our-favorite-vegetarian-recipes",
  "recipeType": "vegetarian",
  "results_wanted": 20,
  "max_pages": 2
}
```

### Collect recipes that use a specific ingredient

Ingredient pages are useful for keyword-style recipe research, such as banana, chocolate, or chicken recipes.

```json
{
  "startUrl": "https://www.epicurious.com/ingredient/banana",
  "recipeType": "banana",
  "results_wanted": 30,
  "max_pages": 2
}
```

### Collect a single recipe

Paste any Epicurious recipe URL to collect one complete record.

```json
{
  "startUrl": "https://www.epicurious.com/recipes/food/views/bombay-toasties-masala-chile-cheese-tara-obrady",
  "results_wanted": 1,
  "max_pages": 1
}
```

### Collect a fast URL list

Disable detail collection when you only need titles, descriptions, images, and links.

```json
{
  "startUrl": "https://www.epicurious.com/ingredient/chocolate",
  "recipeType": "chocolate",
  "collectDetails": false,
  "results_wanted": 50,
  "max_pages": 2
}
```

## Sample Output

Values are shortened for readability. A full record contains the complete ingredient and instruction lists.

```json
{
  "title": "Bombay Masala Cheese Toasties",
  "author": "Tara O'Brady",
  "description": "Melty, cheesy, crunchy, spicy: these sandwiches, a street food favorite in India, check all the boxes.",
  "recipe_type": "vegetarian",
  "ingredients": [
    "1 Granny Smith apple, cored, cut into large pieces",
    "Juice of 1 lime",
    "1 (1\") piece ginger, peeled",
    "2 garlic cloves, peeled",
    "1 cup cilantro leaves with tender stems"
  ],
  "ingredients_count": 5,
  "instructions": "Puree the chutney ingredients. | Cook the mustard seeds and spices. | Assemble and toast the sandwiches.",
  "instructions_list": [
    "Puree the chutney ingredients.",
    "Cook the mustard seeds and spices.",
    "Assemble and toast the sandwiches."
  ],
  "cook_time": "25 minutes",
  "total_time": "35 minutes",
  "servings": "Makes 4",
  "difficulty": "Easy",
  "category": "Main",
  "cuisine": "Indian",
  "tags": ["sandwich", "chutney", "indian", "vegetarian", "easy"],
  "image_url": "https://assets.epicurious.com/photos/5fdce662a3638a389ff839b0/16:9/w_5428,h_3053,c_limit/BombayToastie_HERO_RECIPE_2-121620_6533.jpg",
  "date_published": "2021-01-20T13:42:51.813-05:00",
  "rating_value": 4.5,
  "rating_count": 15,
  "url": "https://www.epicurious.com/recipes/food/views/bombay-toasties-masala-chile-cheese-tara-obrady",
  "scraped_at": "2026-10-23T12:07:20.442Z",
  "_source": "epicurious.com"
}
```

## Tips for Best Results

- Start with 10 to 20 recipes to check field quality before running a large collection.
- Use collection pages for broad datasets and ingredient pages for focused, keyword-style research.
- Set `max_pages` when a listing has many pages. The Actor stops at the page limit even if `results_wanted` is higher.
- Leave `collectDetails` enabled when you need ingredients and instructions. Disable it for a faster URL inventory.
- A collection may contain fewer recipes than `results_wanted` because some links point to articles or videos instead of recipes.
- Some recipes do not publish prep time, cuisine, ratings, or nutrition. Missing fields are omitted rather than filled with guessed values.
- Use Apify Proxy for large or scheduled runs if you see repeated request failures.

## Integrations

- **Google Sheets** - Send recipe datasets to a spreadsheet for review and sharing.
- **Webhooks** - Trigger a workflow when a run finishes.
- **Make or Zapier** - Connect results to no-code automations.
- **API** - Retrieve dataset items programmatically for apps, dashboards, or AI pipelines.
- **CSV, Excel, JSON, XML** - Export datasets in the format your team already uses.

## Frequently Asked Questions

### Does Epicurious Recipes Scraper support keyword search?

No. The Actor accepts Epicurious collection, ingredient, and recipe URLs. Use an ingredient page or a themed collection when you want recipes around a keyword such as banana, chocolate, or chicken.

### Can I export the dataset to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule the Actor to run automatically?

Yes. Create a schedule in Apify Console and set the input for each refresh. Scheduled runs work well for tracking new recipes in a collection or ingredient page.

### Can I collect a single recipe?

Yes. Paste the recipe URL into `startUrl` and set `results_wanted` to `1`.

### Why did the run save fewer recipes than I requested?

The collection may contain fewer recipe links than the requested limit, or some links may point to articles, videos, or other non-recipe pages. Duplicate URLs are removed.

### Why are some output fields empty?

Epicurious does not publish every field for every recipe. Timing, cuisine, ratings, and nutrition can be missing at the source. The Actor leaves those fields out instead of inventing values.

### Can I run the Actor without collecting full recipe details?

Yes. Set `collectDetails` to `false` to collect titles, descriptions, images, and URLs without visiting each recipe page.

### Is it legal to collect data from Epicurious?

Scraping public web data can be legal, but rules vary by location and use case. You are responsible for complying with applicable laws, Epicurious terms, and privacy requirements.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate collection of publicly available recipe data. Users are responsible for using the data responsibly and complying with applicable laws and website terms.
