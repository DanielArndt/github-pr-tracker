# Changelog

## 0.1.0 (2026-10-08)


### Features

* add option to include assigned pull requests ([bc60f1a](https://github.com/DanielArndt/github-pr-tracker/commit/bc60f1a7156fd2740a0ed45ce8ccc68b9018f054))
* add snooze and permanent dismiss PR actions ([97ac824](https://github.com/DanielArndt/github-pr-tracker/commit/97ac82414f2e0d358539bbc9afeba51abe39472d))
* add toggle option for including team review requests (default: off) ([778611a](https://github.com/DanielArndt/github-pr-tracker/commit/778611a724711b37739aa8955c12b9f898d0c203))
* **classifier:** add pending checks section for approved prs ([9d12172](https://github.com/DanielArndt/github-pr-tracker/commit/9d1217264c694b9a71a90bdb9ea263f682c1ffdc))
* **indicator:** add light style palette ([7c748ec](https://github.com/DanielArndt/github-pr-tracker/commit/7c748ec7b4d2f8511fbcccc7b948b4a4fe5dcdcb))
* initial commit for GitHub PR Tracker GNOME Shell extension ([4da7caf](https://github.com/DanielArndt/github-pr-tracker/commit/4da7caf96a81540e8bb44bffbeb9c1db605cfe77))
* **menu:** add dismiss and undo buttons with dismissed section ([bd6d0a3](https://github.com/DanielArndt/github-pr-tracker/commit/bd6d0a360031b86071efce5eec4585cd561c18ef))
* **menu:** expand all dropdown sections by default except dismissed ([b52041b](https://github.com/DanielArndt/github-pr-tracker/commit/b52041ba9c7491caad86e3d4cc64bf9c97a8124f))
* **menu:** make username in header link to github pulls inbox ([e4661d3](https://github.com/DanielArndt/github-pr-tracker/commit/e4661d312fa5b869715ad5165fccffd0f99df90c))
* **prefs:** provide link to create token with pre-populated scopes ([2822433](https://github.com/DanielArndt/github-pr-tracker/commit/2822433f3bb82cace99f6fd5b1e60b83ea9a9bd0))
* **prefs:** refresh immediately when token is saved or cleared ([9033f70](https://github.com/DanielArndt/github-pr-tracker/commit/9033f708f2604f412cedbf8df27af4ce2c519b4e))


### Bug Fixes

* **auth:** reload token from keyring on every refresh ([bef26bb](https://github.com/DanielArndt/github-pr-tracker/commit/bef26bb72a135d726bbefd20c08a5890bcf1578e))
* avoid touching disabled extension state after async work ([84c880d](https://github.com/DanielArndt/github-pr-tracker/commit/84c880da49702879a890b150bd104f84480864a7))
* **ci:** configure initial release version as 0.1.0 ([#6](https://github.com/DanielArndt/github-pr-tracker/issues/6)) ([619d921](https://github.com/DanielArndt/github-pr-tracker/commit/619d92115922162946eebf9661b42c659619d4f1))
* **classifier:** do not mark PRs awaiting workflow approval as ready to merge ([6f6ad88](https://github.com/DanielArndt/github-pr-tracker/commit/6f6ad889fe7370312c3800ea839e7fee6ecac69b))
* **classifier:** hide pull requests already reviewed by user ([bcb170f](https://github.com/DanielArndt/github-pr-tracker/commit/bcb170f4cb0d622f2d5e10d2d7fdb5363479e32f))
* escape user-controlled text shown as markup ([c8aedb5](https://github.com/DanielArndt/github-pr-tracker/commit/c8aedb551b946f174293e8dde588ab80be8bd60f))
* **graphql:** fix query for required status checks and branch protection ([12afe0f](https://github.com/DanielArndt/github-pr-tracker/commit/12afe0f26be087075a499c4d11f50bb80767dd41))
* **graphql:** query authored PRs via search API to support internal repos ([b5af24b](https://github.com/DanielArndt/github-pr-tracker/commit/b5af24bbf74e93a4e91345e63a5db9f2272c0821))
* **graphql:** reject cancelled requests and ignore superseded refreshes ([6980fb9](https://github.com/DanielArndt/github-pr-tracker/commit/6980fb9372cdffae3870586464840eb42cc0dbda))
* **graphql:** show partial results when GitHub returns errors with data ([94903e0](https://github.com/DanielArndt/github-pr-tracker/commit/94903e0f965bb9708b3c9d4c0b261271b0a47e11))
* **graphql:** stop silently truncating PR details ([33c7bdc](https://github.com/DanielArndt/github-pr-tracker/commit/33c7bdc241b53f3a64ec3b98a6b8634819f536e2))
* **indicator:** fix elongated pill badges by scoping icon styles ([8814005](https://github.com/DanielArndt/github-pr-tracker/commit/8814005e4c17245e4a93fb90d15b7b03727ee237))
* **indicator:** pick the light palette per widget from theme colors ([e532c3c](https://github.com/DanielArndt/github-pr-tracker/commit/e532c3cf22fd8cddbe53de503e9c2a1cc8c0d294))
* **menu:** keep default expanded sections open across menu toggles ([0509a33](https://github.com/DanielArndt/github-pr-tracker/commit/0509a33ff54f0b0f226c1e362dc79a2ba7d569f8))
* **menu:** keep the last-updated footer accurate ([d6b7dac](https://github.com/DanielArndt/github-pr-tracker/commit/d6b7dacc3b7d0e5941f6fe7114f1e0bfca5d7665))
* **menu:** remove pending idle source when a PR row is destroyed ([9feb592](https://github.com/DanielArndt/github-pr-tracker/commit/9feb5928d20df6191ee85ba1147563d714536ba7))
* **menu:** remove unsupported set_cursor_type call ([8f65dbc](https://github.com/DanielArndt/github-pr-tracker/commit/8f65dbc7a6d7dc80b2cc78a5e163e6f66db3becd))
* prune dismissals of PRs that are no longer fetched ([ca26962](https://github.com/DanielArndt/github-pr-tracker/commit/ca269624796967606c8928ccf1d48ef8a6864c1f))
* reset cached PR nodes on enable and disable ([5792121](https://github.com/DanielArndt/github-pr-tracker/commit/579212167a4bbf250c00b66109e1e0a3b1292ceb))


### Performance Improvements

* **graphql:** optimize queries and remove read:org scope dependency ([3a99628](https://github.com/DanielArndt/github-pr-tracker/commit/3a996281a9b085eca0f3c452bf4570955b0c62db))
