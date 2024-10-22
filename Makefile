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

jswasi_sources := $(shell find $(project_dir)/src -type f -name '*.ts')
jswasi_compiled := $(subst $(project_dir)/src,$(work_dir),$(jswasi_sources:.ts=.js))

index_dist := $(dist_dir)/index.html

resources_dist := $(subst $(assets_dir),$(resources_dist_dir),$(shell find $(assets_dir) -type f ! -name '*.html'))

VERSION := $(shell cat $(project_dir)/src/VERSION)


.PHONY: standalone
standalone: embed $(resources_dist) $(index_dist) $(third_party_dist_dir)/hterm.js

.PHONY: embed
embed: $(if $(MINIFY),$(dist_dir)/jswasi.js,$(subst $(work_dir),$(dist_dir),$(jswasi_compiled)) $(third_party_dist_dir)/vfs.js $(third_party_dist_dir)/idb-keyval.js $(third_party_dist_dir)/js-untar.js)

.PHONY: clean
clean:
	rm -rf dist

.PHONY: clean-all
clean-all: clean
	rm -rf work

$(dist_dir) $(work_dir) $(resources_dist_dir) $(resources_work_dir) $(third_party_dist_dir) $(third_party_work_dir): %:
	mkdir -p $@


$(jswasi_compiled): %: $(jswasi_sources) $(third_party_work_dir)/js-untar.js $(third_party_work_dir)/vfs.js $(third_party_work_dir)/idb-keyval.js
	tsc


$(resources_work_dir)/%: $(assets_dir)/% | $(resources_work_dir)
	cp $< $@

$(resources_work_dir)/motd.txt: $(assets_dir)/motd.txt $(project_dir)/src/VERSION | $(resources_work_dir)
	VERSION="$(shell printf '%*s%s' $((25 - $(shell echo $(VERSION) | wc -c))) 25 $(VERSION))" \
	envsubst <$(assets_dir)/motd.txt > $(resources_work_dir)/motd.txt

$(third_party_work_dir)/%.js: $(third_party_dir)/%.js | $(third_party_work_dir)
	cp $< $@


$(resources_dist_dir)/%: $(resources_work_dir)/% | $(resources_dist_dir)
	cp $< $@

$(third_party_dist_dir)/%.js: $(third_party_work_dir)/%.js | $(third_party_dist_dir)
	cp $< $@

ifdef MINIFY
index := $(assets_dir)/index.html
$(work_dir)/service-worker-minified.js: $(work_dir)/service-worker.js | $(work_dir)
	cd $(work_dir) && \
	sed '/const urlsToCache/,/];/c\const urlsToCache = ["./jswasi.js"];' $< | \
	esbuild $(ESBUILD_ARGS) --outfile=$@

$(work_dir)/process-minified.js: $(work_dir)/process.js | $(work_dir)
	cd $(work_dir) && \
	echo 'export default URL.createObjectURL(new Blob([(function(){' > process-minified.js && \
	esbuild $(ESBUILD_ARGS) ./process.js >> process-minified.js && \
	echo '}).toString().slice(11,-1)], {type:"text/javascript"}))' >> process-minified.js

$(work_dir)/jswasi-minified.js: $(work_dir)/jswasi.js $(work_dir)/process-minified.js | $(work_dir)
	cd $(work_dir) && \
	(echo 'import processWorker from "./process-minified.js";' && \
	sed 's|"process.js"|processWorker|g;s|"service-worker.js"|"jswasi.js"|g;s|export ||g' jswasi.js ; \
	echo 'Object.defineProperty(window, "Jswasi", {value:Jswasi,writable:false});') | \
	esbuild $(ESBUILD_ARGS) --outfile=$(shell basename $@)

$(dist_dir)/jswasi.js: $(work_dir)/process-minified.js $(work_dir)/jswasi-minified.js $(work_dir)/service-worker-minified.js | $(dist_dir)
	echo 'if(typeof window==="undefined"){' > $@
	cat $(work_dir)/service-worker-minified.js >> $@
	echo '}else{' >> $@
	cat $(work_dir)/jswasi-minified.js >> $@
	echo '}' >> $@
else
index := $(assets_dir)/index-module.html
$(dist_dir)/%.js: $(work_dir)/%.js | $(dist_dir)
	install -D -m644 $< $@
endif

$(index_dist): $(index) | $(dist_dir)
	cp $(index) $(index_dist)


$(project_dir)/tests/unit/node_modules: $(project_dir)/tests/unit/package.json
	cd $(project_dir)/tests/unit && \
	npm install

.PHONY: test
test: $(project_dir)/tests/unit/node_modules
	cd tests/unit && \
	npm run test
