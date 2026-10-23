# Epicurious data sources

Findings from live requests on 2026-10-23. The actor reads server-rendered pages with `impit`; no private API or authentication is required.

## Selected sources

| Purpose | Request | Primary payload |
|---|---|---|
| Recipe list | `GET /recipes-menus/*`, `GET /ingredient/*` | `window.__PRELOADED_STATE__` → `transformed.gallery.items` or `transformed.tag.items` |
| Recipe detail | `GET /recipes/food/views/*` | JSON-LD `Recipe` plus `transformed.recipe` |
| Pagination | `?page=2`, `?page=3`, ... | `transformed.tag.nextPageURL`, `head.nextPage`, or `<link rel="next">` |

Recipe detail pages also expose `articleBody`, `keywords`, `recipeIngredient`, `recipeInstructions`, `recipeYield`, `author`, `aggregateRating`, and publish dates in JSON-LD.

## Extraction order

1. **Hydration state** — balanced-brace scan of `window.__PRELOADED_STATE__`. A regex is unsafe because recipe text can contain `};`.
2. **JSON-LD** — parse every `application/ld+json` block, including `@graph` and `mainEntity`, then select `Recipe` or `ItemList` nodes.
3. **HTML fallback** — recipe anchors for lists; Open Graph and meta tags for detail pages.

If a detail page fails after retries, the actor emits a partial record from the list item instead of dropping the URL. The run fails when no recipes are saved or no detail page yields recipe data.

## Pagination

- Ingredient listing pages return 20 recipes per page.
- `transformed.tag.nextPageURL` is a relative link such as `/ingredient/banana?page=2`.
- `head.nextPage` is the absolute equivalent.
- Search pages paginate, but `robots.txt` disallows `/search`, so search is not used as a primary source.

## Endpoints tested and rejected

| Candidate | Result |
|---|---|
| `/api/*`, `*.json` | 404 |
| `https://coral.condenastdigital.com/api/graphql` | POST accepts `{ __typename }`; introspection disabled |
| `https://graphql.condenast.io/graphql` | 401 `UNAUTHENTICATED` |
| `/search/` | 404 |
| `/tag/vegetarian`, `/special_consideration/vegetarian` | 404; use `/ingredient/*` or `/recipes-menus/*` |

## Request behavior

- Browser profiles rotate on retry: `chrome`, `firefox`, `chrome131`, `ios18`, `okhttp5`, `firefox144`.
- Retries cover 403, 408, 425, 429, 500, 502, 503, and 504 with backoff. `Retry-After` is honored up to 10 seconds.
- Challenge pages (`cf-chl`, `Just a moment...`, `Attention Required! | Cloudflare`, `Access Denied`, `px-captcha`) are treated as failures and retried with a new identity.
- Detail pages run at 25 concurrent requests. A 30-URL test completed in 8.8 seconds with the `chrome` profile.
- Proxies are optional and off by default. When configured, retries request a new proxy session.

## Robots and usage

`robots.txt` disallows `/search`, `/auth/`, `/account/`, `/user/`, and arbitrary query strings. It allows `?page` pagination and the recipe, collection, and ingredient paths used here. Use the actor for lawful collection and respect Epicurious terms.
