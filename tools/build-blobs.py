"""Build a watch's code blobs (see native/src/c/blob.h): the chart builder and the minute renderer, each its own
resource, which the app loads only while it is wanted.

    python3 tools/build-blobs.py --face enroute|fuller --platform emery|gabbro --out DIR [--cc PATH-TO-arm-none-eabi-gcc]

writes DIR/builder_FACE~PLATFORM.bin and DIR/renderer_FACE~PLATFORM.bin (the two apps share their resources; the SDK
gives each platform its own, by the tag). Each is compiled with the Pebble SDK's own compiler and flags (the watch
app's: native/wscript), for the platform's screen (on the Round 2, ENR_ROUND) and the face, its entry table first
(native/blob/*_blob.c) and the C library's few functions it uses (native/blob/blob_libc.c), linked at address 0
with libgcc's arithmetic (native/blob/blob.ld), and packed as

    header   magic "GTCB", the image's size, the zeroed memory after it (bss), the relocations' count, the entry
             table's offset: five little-endian uint32s
    image    the code and its constant data (and initialised data, if any)
    relocs   one uint16 for each word holding an absolute address: its offset / 4

main.c loads it into memory, adds the load address to each listed word, flushes the caches (memory_cache_flush)
and calls the entry table. Only R_ARM_ABS32 relocations need it (calls and branches are relative); anything else
absolute fails the build. After Planisphere's tools/build_blob.py.
"""
import argparse
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "native" / "src" / "c"
BLOB = ROOT / "native" / "blob"
SDK = Path(os.environ.get("PEBBLE_SDK", Path.home() / ".local/share/pebble-sdk/SDKs/current"))
# The watch app's flags (native/wscript): arithmetic as the JavaScript's, optimised for size across the sources,
# fewer functions inlined and loops left as written (each stage of a build a frame of its own: the stack is 2 KB)
CFLAGS = ["-mcpu=cortex-m3", "-mthumb", "-Os", "-std=gnu11", "-ffunction-sections", "-fdata-sections",
          "-ffp-contract=off", "-fno-common", "-Wall", "-Wno-unused-parameter", "-Wno-unused-function",
          "-fno-tree-loop-distribute-patterns", "-flto", "-DPBL_SDK_3", f"-I{SRC}",
          "-fno-inline-functions-called-once", "-fno-early-inlining", "-fno-partial-inlining", "-fno-tree-tail-merge",
          "-fno-tree-pre", "-fno-reorder-blocks", "-fno-move-loop-invariants", "-fno-tree-dominator-opts",
          "-fno-tree-loop-im", "-fno-tree-scev-cprop", "-fmerge-all-constants"]
CORE = ["chart.c", "fuller.c", "map_pack.c", "segments.c", "passes.c", "fmath.c", "enroute_core.c",
        "departure_font.c"]
# each blob: its entry table, then the core (only what the table reaches is kept)
BLOBS = {"builder": "builder_blob.c", "renderer": "renderer_blob.c"}
MAGIC = 0x42435447          # "GTCB"
RELATIVE = ("R_ARM_THM_CALL", "R_ARM_THM_JUMP24", "R_ARM_THM_JUMP11", "R_ARM_THM_JUMP8", "R_ARM_THM_JUMP19",
            "R_ARM_REL32", "R_ARM_PREL31", "R_ARM_THM_PC8", "R_ARM_THM_PC12", "R_ARM_THM_ALU_PREL_11_0",
            "R_ARM_V4BX", "R_ARM_NONE")


def run(*args):
    out = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"build-blobs: {Path(str(args[0])).name} failed:\n{out.stderr.strip()}")
    return out.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--face", required=True, choices=["enroute", "fuller"])
    ap.add_argument("--platform", required=True, choices=["emery", "gabbro"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--cc", help="the SDK's arm-none-eabi-gcc")
    a = ap.parse_args()
    sdks = sorted(Path.home().glob(".local/share/pebble-sdk/SDKs/*/toolchain/arm-none-eabi/bin/arm-none-eabi-gcc"))
    tc = SDK / "toolchain" / "arm-none-eabi" / "bin"
    cc = (a.cc or (str(tc / "arm-none-eabi-gcc") if (tc / "arm-none-eabi-gcc").exists() else None) or
          shutil.which("arm-none-eabi-gcc") or (str(sdks[-1]) if sdks else None))
    if not cc:
        sys.exit("build-blobs: no arm-none-eabi-gcc (install the Pebble SDK, or pass --cc)")
    tc = Path(cc).resolve().parent
    work = ROOT / "native" / "build" / "blobs" / a.platform / a.face
    defines = ["-DFACE_" + a.face.upper()] + (["-DENR_ROUND=1"] if a.platform == "gabbro" else [])
    for name, table in BLOBS.items():
        build(tc, work / name, f"{name}_{a.face}~{a.platform}", [BLOB / table] + [SRC / f for f in CORE] +
              [BLOB / "blob_libc.c"], defines, Path(a.out))


def build(tc, work, name, sources, defines, out_dir):
    work.mkdir(parents=True, exist_ok=True)
    gcc = tc / "arm-none-eabi-gcc"
    objs = []
    for src in sources:
        obj = work / (src.stem + ".o")
        run(gcc, *CFLAGS, *defines, "-c", src, "-o", obj)
        objs.append(obj)
    elf = work / f"{name}.elf"
    run(gcc, *CFLAGS, *defines, "-nostdlib", "-nostartfiles", f"-Wl,-T,{BLOB / 'blob.ld'}", "-Wl,--gc-sections",
        "-Wl,-q", "-o", elf, *objs, "-lgcc")
    # the sections: the image is .text then .data, contiguous; .bss after them is only zeroed memory
    sec = {}
    for line in run(tc / "arm-none-eabi-readelf", "-SW", elf).splitlines():
        m = re.match(r"\s*\[\s*\d+\]\s+(\S+)\s+\S+\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)", line)
        if m:
            sec[m.group(1)] = (int(m.group(2), 16), int(m.group(3), 16))
    text_a, text_n = sec[".text"]
    data_a, data_n = sec.get(".data", (text_a + text_n, 0))
    bss_a, bss_n = sec.get(".bss", (data_a + data_n, 0))
    assert text_a == 0 and data_a == text_a + text_n, "the image must start at 0 and run on unbroken"
    image_bin = work / "image.bin"
    run(tc / "arm-none-eabi-objcopy", "-O", "binary", "-j", ".text", "-j", ".data", elf, image_bin)
    image = image_bin.read_bytes()
    assert len(image) == text_n + data_n, (len(image), text_n, data_n)
    bss = bss_n + (bss_a - (data_a + data_n))
    # the absolute addresses to relocate
    relocs, section = [], None
    for line in run(tc / "arm-none-eabi-readelf", "-rW", elf).splitlines():
        m = re.match(r"Relocation section '\.rel\.(\S+)'", line)
        if m:
            section = m.group(1)
            continue
        m = re.match(r"\s*([0-9a-f]+)\s+[0-9a-f]+\s+(R_ARM_\S+)", line)
        if not m or section is None:
            continue
        off, kind = int(m.group(1), 16), m.group(2)
        if not (section.startswith("text") or section.startswith("data") or section.startswith("rodata")):
            continue
        if kind == "R_ARM_ABS32":
            assert off % 4 == 0 and off < len(image), (hex(off), section)
            relocs.append(off)
        elif kind not in RELATIVE:
            sys.exit(f"build-blobs: an absolute relocation the loader cannot apply: {kind} at {off:#x} in {section}")
    relocs = sorted(set(relocs))
    syms = {n: int(v, 16) for v, n in re.findall(r"^([0-9a-f]+) \S (\S+)$", run(tc / "arm-none-eabi-nm", elf), re.M)}
    api = syms["gt_api"]
    assert len(image) < 4 * 65536, "relocation offsets are kept as uint16 words"
    blob = struct.pack("<5I", MAGIC, len(image), bss, len(relocs), api) + image + \
        b"".join(struct.pack("<H", r // 4) for r in relocs)
    out = out_dir / f"{name}.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_bytes() != blob:
        out.write_bytes(blob)
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: {len(blob):,} bytes "
          f"({len(image):,} image, {bss} bss, {len(relocs)} relocations)")


if __name__ == "__main__":
    main()
