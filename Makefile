project_dir := $(shell pwd)
dist_dir := $(project_dir)/dist
resources_dir := $(dist_dir)/resources
third_party_dist_dir := $(dist_dir)/third_party
assets_dir := $(project_dir)/src/assets
third_party_dir := $(project_dir)/third_party

js_virtualfs := $(third_party_dir)/vfs.js
js_virtualfs_dist := $(third_party_dist_dir)/vfs.js

index := $(project_dir)/src/index.html
index_dist := $(dist_dir)/index.html

resources := $(subst $(assets_dir),$(resources_dir),$(wildcard $(assets_dir)/*))
third_party_sources := $(subst $(third_party_dir),$(third_party_dist_dir),$(wildcard $(third_party_dir)/*.js))

wash := $(resources_dir)/wash
wash_md5 := $(resources_dir)/wash.md5
wash_url := https://github.com/antmicro/wash/releases/download/v0.1.2/wash.wasm

wasibox := $(resources_dir)/wasibox
wasibox_url := https://github.com/antmicro/wasibox/releases/download/v0.1.1/wasibox.wasm

coreutils := $(resources_dir)/coreutils
coreutils_url := https://github.com/antmicro/coreutils/releases/download/v0.1.0/coreutils.wasm

VERSION := $(shell cat $(project_dir)/src/VERSION)

.PHONY: standalone
standalone: embed $(resources) $(index_dist) $(wash) $(wash_md5) $(wasibox) $(coreutils)

.PHONY: embed
embed: $(js_virtualfs_dist) $(third_party_sources)
	tsc

.PHONY: test
test: $(project_dir)/tests/unit/node_modules embed
	cd tests/unit && \
	npm run test

$(dist_dir):
	mkdir -p $(dist_dir)

$(resources_dir):
	mkdir -p $(resources_dir)

$(third_party_dist_dir):
	mkdir -p $(third_party_dist_dir)

$(project_dir)/tests/unit/node_modules: $(project_dir)/tests/unit/package.json
	cd $(project_dir)/tests/unit && \
	npm install

$(resources_dir)/%: $(assets_dir)/% | $(resources_dir)
	cp $< $@

$(resources_dir)/motd.txt: $(assets_dir)/motd.txt $(project_dir)/src/VERSION
	VERSION="$(shell printf '%*s%s' $((25 - $(shell echo $(VERSION) | wc -c))) 25 $(VERSION))" \
	envsubst <$(assets_dir)/motd.txt > $(resources_dir)/motd.txt

$(js_virtualfs_dist): $(js_virtualfs) | $(third_party_dist_dir)
	cp $(js_virtualfs) $(js_virtualfs_dist)

$(third_party_dist_dir)/%.js: $(third_party_dir)/%.js | $(third_party_dist_dir)
	cp $< $@

$(index_dist): $(index)
	cp $(index) $(index_dist)

$(wash): | $(resources_dir)
	wget -qO $(wash) $(wash_url) || { rm -f $(wash); exit 1; }

$(wash_md5): $(wash) | $(resources_dir)
	md5sum $(wash) > $(wash_md5)

$(wasibox): | $(resources_dir)
	wget -qO $(wasibox) $(wasibox_url) || { rm -f $(wasibox); exit 1; }

$(coreutils): | $(resources_dir)
	wget -qO $(coreutils) $(coreutils_url) || { rm -f $(coreutils); exit 1; }
