ESBUILD_ARGS := --minify --bundle --format=esm --allow-overwrite

project_dir := $(shell pwd)

dist_dir := $(project_dir)/dist
resources_dist_dir := $(dist_dir)/resources
third_party_dist_dir := $(dist_dir)/third_party

work_dir := $(project_dir)/work
resources_work_dir := $(work_dir)/resources
third_party_work_dir := $(work_dir)/third_party

assets_dir := $(project_dir)/src/assets
third_party_dir := $(project_dir)/third_party

index := $(project_dir)/src/index.html
index_dist := $(dist_dir)/index.html

resources_dist := $(subst $(assets_dir),$(resources_dist_dir),$(wildcard $(assets_dir)/*))
resources_work := $(subst $(assets_dir),$(resources_work_dir),$(wildcard $(assets_dir)/*))

wash_md5 := $(resources_work_dir)/wash.md5
wash_url := https://github.com/antmicro/wash/releases/download/v0.1.3/wash.wasm
wasibox_url := https://github.com/antmicro/wasibox/releases/download/v0.1.2/wasibox.wasm
coreutils_url := https://github.com/antmicro/coreutils/releases/download/v0.1.1/coreutils.wasm

wasm_sources := wash wasibox coreutils
wasm_sources_work := $(addprefix $(resources_work_dir)/,$(wasm_sources))
wasm_sources_dist := $(addprefix $(resources_dist_dir)/,$(wasm_sources))

minified_sources := $(dist_dir)/jswasi.js $(dist_dir)/service-worker.js

VERSION := $(shell cat $(project_dir)/src/VERSION)


.PHONY: standalone
standalone: embed $(resources_dist) $(index_dist) $(wash_md5) $(wasm_sources_dist) $(resources_dist_dir)/wash.md5 $(third_party_dist_dir)/hterm_all.js

.PHONY: embed
embed: $(minified_sources) $(third_party_dist_dir)/vfs.js $(third_party_dist_dir)/idb-keyval.js $(third_party_dist_dir)/hterm_all.js

.PHONY: compile
compile: $(third_party_work_dir)/vfs.js $(third_party_work_dir)/idb-keyval.js $(resources_work)
	tsc

$(dist_dir) $(work_dir) $(resources_dist_dir) $(resources_work_dir) $(third_party_dist_dir) $(third_party_work_dir): %:
	mkdir -p $@


$(resources_work_dir)/%: $(assets_dir)/% | $(resources_work_dir)
	cp $< $@

$(resources_work_dir)/motd.txt: $(assets_dir)/motd.txt $(project_dir)/src/VERSION | $(resources_work_dir)
	VERSION="$(shell printf '%*s%s' $((25 - $(shell echo $(VERSION) | wc -c))) 25 $(VERSION))" \
	envsubst <$(assets_dir)/motd.txt > $(resources_work_dir)/motd.txt

$(wash_md5): $(resources_work_dir)/wash | $(resources_work_dir)
	md5sum $(resources_work_dir)/wash > $(wash_md5)

$(wasm_sources_work): %: | $(resources_dist_dir)
	wget -qO $@ $($(shell basename $@)_url) || { rm -f $@; exit 1; }


$(resources_dist_dir)/%: $(resources_work_dir)/% | $(resources_dist_dir)
	cp $< $@

$(third_party_dist_dir)/%.js: $(third_party_dir)/%.js | $(third_party_dist_dir)
	cp $< $@

$(third_party_work_dir)/%.js: $(third_party_dir)/%.js | $(third_party_work_dir)
	cp $< $@

$(index_dist): $(project_dir)/src/index.html $(index) | $(dist_dir)
	cp $(index) $(index_dist)

$(dist_dir)/service-worker.js: compile | $(dist_dir) $(work_dir)
	cd $(work_dir) && esbuild $(ESBUILD_ARGS) --outfile=$(dist_dir)/service-worker.js service-worker.js

$(work_dir)/process-minified.js: compile | $(work_dir)
	cd $(work_dir) && \
	echo 'export default URL.createObjectURL(new Blob([(function(){' > process-minified.js && \
	esbuild $(ESBUILD_ARGS) ./process.js >> process-minified.js && \
	echo '}).toString().slice(11,-1)], {type:"text/javascript"}))' >> process-minified.js

$(dist_dir)/jswasi.js: compile $(work_dir)/process-minified.js | $(dist_dir) $(work_dir)
	cd $(work_dir) && \
	(echo 'import processWorker from "./process-minified.js";' && \
	sed 's|"process.js"|processWorker|g' jswasi.js) | \
	esbuild $(ESBUILD_ARGS) --outfile=$(dist_dir)/jswasi.js

$(project_dir)/tests/unit/node_modules: $(project_dir)/tests/unit/package.json
	cd $(project_dir)/tests/unit && \
	npm install

.PHONY: test
test: $(project_dir)/tests/unit/node_modules embed
	cd tests/unit && \
	npm run test
