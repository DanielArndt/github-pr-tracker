UUID = github-pr-tracker@dan.arndt.ca
SRC_DIR = .
BUILD_DIR = build
SCHEMA_DIR = schemas
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all test compile-schemas pack install uninstall clean

all: compile-schemas test pack

compile-schemas:
	glib-compile-schemas $(SCHEMA_DIR)

test: compile-schemas
	gjs -m tests/testClassifier.js
	GSETTINGS_BACKEND=memory gjs -m tests/testDismiss.js
	GSETTINGS_BACKEND=memory gjs -m tests/testTokenSync.js
	gjs -m tests/testGithubClient.js
	gjs -m tests/testTime.js
	gjs -m tests/testPrNodes.js
	GSETTINGS_BACKEND=memory GI_TYPELIB_PATH=/usr/lib/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib/gnome-shell gjs -m tests/testPrefs.js

pack: compile-schemas
	@mkdir -p $(BUILD_DIR)
	gnome-extensions pack --force \
		--extra-source=src \
		--extra-source=icons \
		--extra-source=LICENSE \
		--schema=$(SCHEMA_DIR)/org.gnome.shell.extensions.github-pr-tracker.gschema.xml \
		-o $(BUILD_DIR)

install: pack
	gnome-extensions install --force $(BUILD_DIR)/$(UUID).shell-extension.zip
	glib-compile-schemas $(INSTALL_DIR)/schemas/

uninstall:
	gnome-extensions uninstall $(UUID)

clean:
	rm -rf $(BUILD_DIR) /tmp/$(UUID).shell-extension.zip
