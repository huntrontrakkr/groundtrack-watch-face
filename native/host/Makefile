# Host harness and a watch-side size check for the native core.
CORE=../src/c/enroute_core.c ../src/c/departure_font.c
CFLAGS=-std=c11 -O2 -Wall -Wextra -Wno-unused-parameter -ffp-contract=off

harness: harness.c $(CORE) ../src/c/fmath.c ../src/c/enroute_core.h ../src/c/departure_font.h
	$(CC) $(CFLAGS) -o $@ harness.c $(CORE) ../src/c/fmath.c -lm

# The watch's own chart builder, writing the phone's scene format.
CHART_SRC=../src/c/chart.c ../src/c/departure_font.c ../src/c/map_pack.c ../src/c/segments.c ../src/c/fmath.c ../src/c/passes.c
chart_test: chart_test.c $(CHART_SRC) ../src/c/chart.h ../src/c/fmath.h ../src/c/generated/chart_data.h ../src/c/departure_font.h ../src/c/enroute_core.h
	$(CC) $(CFLAGS) -std=gnu11 -o $@ chart_test.c $(CHART_SRC) -lm

# Host check of the shared sine and cosine.
fmath_test: fmath_test.c ../src/c/fmath.c ../src/c/fmath.h
	$(CC) $(CFLAGS) -o $@ fmath_test.c ../src/c/fmath.c -lm

# Host check of the Sun and Moon segments.
segments_test: segments_test.c ../src/c/segments.c ../src/c/segments.h ../src/c/fmath.c
	$(CC) $(CFLAGS) -o $@ segments_test.c ../src/c/segments.c ../src/c/fmath.c -lm

# Host check of the map pack decoder.
map_test: map_test.c ../src/c/map_pack.c ../src/c/map_pack.h
	$(CC) $(CFLAGS) -o $@ map_test.c ../src/c/map_pack.c

# The same with single-precision night arithmetic, as the watch would run it.
harness-float: harness.c $(CORE) ../src/c/fmath.c ../src/c/enroute_core.h ../src/c/departure_font.h
	$(CC) $(CFLAGS) -DENR_FLOAT -o $@ harness.c $(CORE) ../src/c/fmath.c -lm

# The core compiled for the watch's Cortex-M4 (single-precision FPU), with
# single-precision arithmetic, to measure its code and static data.
ARMFLAGS=-std=c11 -Os -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16 -ffunction-sections -fdata-sections -Wall
arm: ../src/c/enroute_core.c
	arm-none-eabi-gcc $(ARMFLAGS) -DENR_FLOAT -c ../src/c/enroute_core.c -o enroute_core-float.o
	arm-none-eabi-gcc $(ARMFLAGS) -c ../src/c/enroute_core.c -o enroute_core-double.o
	arm-none-eabi-size enroute_core-float.o enroute_core-double.o

# Type-check the watch app against a stand-in pebble.h (see stub/pebble.h);
# the real check is the Pebble SDK build.
shim-check: ../src/c/main.c
	$(CC) -std=gnu11 -Wall -Wextra -Wno-unused-parameter -Istub -I../src/c -DENR_FLOAT -fsyntax-only ../src/c/main.c
	arm-none-eabi-gcc -std=gnu11 -Wall -Wno-unused-parameter -Istub -I../src/c -DENR_FLOAT -mcpu=cortex-m4 -mthumb -fsyntax-only ../src/c/main.c

clean:
	rm -f harness harness-float map_test segments_test fmath_test chart_test *.o
.PHONY: arm shim-check clean
