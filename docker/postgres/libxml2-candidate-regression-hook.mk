override_dh_auto_test-arch:
	set -eu; \
	$(MAKE) -C builddir/main testapi testchar testdict testlimits testrecurse; \
	bash /inputs/scripts/ci/run-libxml2-candidate-self-tests.sh builddir/main /usr/share/taky-libxml2-candidate/self-tests; \
	regression_log=/usr/share/taky-libxml2-candidate/cve-regression-test.log; \
	./builddir/main/testrecurse -v "Parsing non-recursive huge case" > "$$regression_log" 2>&1; \
	cat "$$regression_log"; \
	grep -Fxq "## Parsing non-recursive huge case" "$$regression_log"; \
	test "$$(grep -Fxc "Ran 1 tests, no errors" "$$regression_log")" -eq 1; \
	grep -Fxq "Total 1 tests, no errors" "$$regression_log"
