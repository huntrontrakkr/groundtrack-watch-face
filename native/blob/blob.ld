/* A code blob of the Round 2's (tools/build-blobs.py): linked at address 0,
 * its entry table first; main.c adds its load address to every absolute
 * address (the relocations listed after the image). */
ENTRY(gt_api)
SECTIONS
{
  . = 0;
  .text : {
    KEEP(*(.gt_api))
    *(.text .text.*)
    *(.rodata .rodata.*)
    . = ALIGN(4);
  }
  .data : {
    *(.data .data.*)
    . = ALIGN(4);
  }
  .bss (NOLOAD) : {
    *(.bss .bss.* COMMON)
    . = ALIGN(4);
  }
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment) *(.note*) *(.ARM.attributes) }
}
