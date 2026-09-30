# Host harness and a watch-side size check for the native core.
CORE=../src/c/enroute_core.c
CFLAGS=-std=c11 -O2 -Wall -Wextra -Wno-unused-parameter

harness: harness.c $(CORE) ../src/c/enroute_core.h ../src/c/departure_font.h
	$(CC) $(CFLAGS) -o $@ harness.c $(CORE) -lm

# The same with single-precision night arithmetic, as the watch would run it.
harness-float: harness.c $(CORE) ../src/c/enroute_core.h ../src/c/departure_font.h
	$(CC) $(CFLAGS) -DENR_FLOAT -o $@ harness.c $(CORE) -lm

# The core compiled for the watch's Cortex-M4 (single-precision FPU), with
# single-precision arithmetic, to measure its code and static data.
ARMFLAGS=-std=c11 -Os -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16 -ffunction-sections -fdata-sections -Wall
arm: $(CORE)
	arm-none-eabi-gcc $(ARMFLAGS) -DENR_FLOAT -c $(CORE) -o enroute_core-float.o
	arm-none-eabi-gcc $(ARMFLAGS) -c $(CORE) -o enroute_core-double.o
	arm-none-eabi-size enroute_core-float.o enroute_core-double.o

# Type-check the watch app against a stand-in pebble.h (see stub/pebble.h);
# the real check is the Pebble SDK build.
shim-check: ../src/c/main.c
	$(CC) -std=gnu11 -Wall -Wextra -Wno-unused-parameter -Istub -I../src/c -DENR_FLOAT -fsyntax-only ../src/c/main.c
	arm-none-eabi-gcc -std=gnu11 -Wall -Wno-unused-parameter -Istub -I../src/c -DENR_FLOAT -mcpu=cortex-m4 -mthumb -fsyntax-only ../src/c/main.c

clean:
	rm -f harness harness-float *.o
.PHONY: arm shim-check clean
