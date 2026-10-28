override_dh_auto_test-arch:
	set -eu; \
	regression_log=/usr/share/taky-libxml2-candidate/cve-regression-test.log; \
	$(MAKE) -C builddir/main testrecurse; \
	./builddir/main/testrecurse -v "Parsing non-recursive huge case" > "$$regression_log" 2>&1; \
	cat "$$regression_log"; \
	grep -Fxq "## Parsing non-recursive huge case" "$$regression_log"; \
	test "$$(grep -Fxc "Ran 1 tests, no errors" "$$regression_log")" -eq 1; \
	grep -Fxq "Total 1 tests, no errors" "$$regression_log"
