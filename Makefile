project_dir := $(shell pwd)
dist_dir := $(project_dir)/dist
resources_dir := $(dist_dir)/resources
vendor_dist_dir := $(dist_dir)/vendor
assets_dir := $(project_dir)/src/assets
vendor_dir := $(project_dir)/vendor

js_virtualfs_dir := $(project_dir)/vendor/js-virtualfs
js_virtualfs := $(js_virtualfs_dir)/dist/vfs.js
js_virtualfs_dist := $(vendor_dist_dir)/vfs.js

index := $(project_dir)/src/index.html
index_dist := $(dist_dir)/index.html

resources := $(subst $(assets_dir),$(resources_dir),$(wildcard $(assets_dir)/*))
vendor_sources := $(subst $(vendor_dir),$(vendor_dist_dir),$(wildcard $(vendor_dir)/*.js))

.PHONY: embed
embed: $(js_virtualfs_dist) $(vendor_sources)
	@npm run build

.PHONY: build
build: embed $(resources) $(index_dist)

$(dist_dir):
	@mkdir -p $(dist_dir)

$(resources_dist_dir):
	@mkdir -p $(resources_dist_dir)

$(vendor_dist_dir):
	@mkdir -p $(vendor_dist_dir)

$(js_virtualfs_dir)/node_modules: $(js_virtualfs_dir)/package.json
	@cd $(js_virtualfs_dir) && \
	npm install

$(js_virtualfs): $(js_virtualfs_dir)/lib/*.js $(js_virtualfs_dir)/node_modules
	@cd $(js_virtualfs_dir) && \
	npm run build

$(resources_dir)/%: $(assets_dir)/% | $(resources_dir)
	cp $< $@

$(js_virtualfs_dist): $(js_virtualfs) | $(vendor_dist_dir)
	@cp $(js_virtualfs) $(vendor_dist_dir)

$(vendor_dist_dir)/%.js: $(vendor_dir)/%.js | $(vendor_dist_dir)
	@cp $< $@

$(index_dist): $(index)
	@cp $(index) $(index_dist)
