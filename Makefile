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

wash := $(resources_dir)/wash
wash_url := https://github.com/antmicro/wash/releases/download/v0.1.0/wash.wasm

wasibox := $(resources_dir)/wasibox
wasibox_url := https://github.com/antmicro/wasibox/releases/download/v0.1.0/wasibox.wasm

coreutils := $(resources_dir)/coreutils
coreutils_url := https://github.com/antmicro/coreutils/releases/download/v0.1.0/coreutils.wasm


.PHONY: standalone
standalone: embed $(resources) $(index_dist) $(wash) $(wasibox) $(coreutils)

.PHONY: embed
embed: $(js_virtualfs_dist) $(vendor_sources)
	tsc

.PHONY: test
test: $(project_dir)/tests/unit/node_modules embed
	cd tests/unit && \
	npm run test

$(dist_dir):
	mkdir -p $(dist_dir)

$(resources_dir):
	mkdir -p $(resources_dir)

$(vendor_dist_dir):
	mkdir -p $(vendor_dist_dir)

$(project_dir)/tests/unit/node_modules: $(project_dir)/tests/unit/package.json
	cd $(project_dir)/tests/unit && \
	npm install

$(js_virtualfs_dir)/node_modules: $(js_virtualfs_dir)/package.json
	cd $(js_virtualfs_dir) && \
	npm install

$(js_virtualfs): $(js_virtualfs_dir)/lib/*.js $(js_virtualfs_dir)/node_modules
	cd $(js_virtualfs_dir) && \
	npm run build

$(resources_dir)/%: $(assets_dir)/% | $(resources_dir)
	cp $< $@

$(js_virtualfs_dist): $(js_virtualfs) | $(vendor_dist_dir)
	cp $(js_virtualfs) $(vendor_dist_dir)

$(vendor_dist_dir)/%.js: $(vendor_dir)/%.js | $(vendor_dist_dir)
	cp $< $@

$(index_dist): $(index)
	cp $(index) $(index_dist)

$(wash): | $(resources_dir)
	wget -qO $(wash) $(wash_url) || { rm -f $(wash); exit 1; }

$(wasibox): | $(resources_dir)
	wget -qO $(wasibox) $(wasibox_url) || { rm -f $(wasibox); exit 1; }

$(coreutils): | $(resources_dir)
	wget -qO $(coreutils) $(coreutils_url) || { rm -f $(coreutils); exit 1; }
