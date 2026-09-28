UUID = github-pr-tracker@dan.arndt.ca
SRC_DIR = .
BUILD_DIR = build
SCHEMA_DIR = schemas
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

# GNOME Shell's private library and data directories, needed by the
# preferences test. Distributions differ (/usr/lib, /usr/lib64, multiarch);
# override with e.g. `make test SHELL_LIBDIR=/opt/gnome/lib/gnome-shell`.
SHELL_LIBDIR ?= $(firstword $(wildcard \
	/usr/lib64/gnome-shell \
	/usr/lib/gnome-shell \
	/usr/lib/*-linux-gnu/gnome-shell) \
	/usr/lib/gnome-shell)
SHELL_DATADIR ?= /usr/share/gnome-shell

.PHONY: all lint test compile-schemas pack install uninstall clean

all: compile-schemas test pack

# Requires `npm ci` once to install ESLint into node_modules/
lint:
	npx --no-install eslint .

compile-schemas:
	glib-compile-schemas $(SCHEMA_DIR)

test: compile-schemas
	gjs -m tests/testClassifier.js
	GSETTINGS_BACKEND=memory gjs -m tests/testDismiss.js
	GSETTINGS_BACKEND=memory gjs -m tests/testTokenSync.js
	gjs -m tests/testGithubClient.js
	gjs -m tests/testTime.js
	gjs -m tests/testPrNodes.js
	GSETTINGS_BACKEND=memory \
		GI_TYPELIB_PATH=$(SHELL_LIBDIR)/girepository-1.0 \
		LD_LIBRARY_PATH=$(SHELL_LIBDIR) \
		GNOME_SHELL_DATADIR=$(SHELL_DATADIR) \
		gjs -m tests/testPrefs.js

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
	rm -rf $(BUILD_DIR) $(SCHEMA_DIR)/gschemas.compiled
