// Builds the hour from the input text on stdin with the watch's chart
// builder and reports what the build took: its peak memory, counted as the
// watch's heap would (each block with 8 bytes of the allocator's own), and
// what the finished hour keeps. HEAP_LIMIT is a heap of that size, modelled
// as the watch's is (heap_model.h): allocations it has no stretch for fail.
//   build_check < input
#include "core_api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "heap_model.h"
static uint8_t *slurp(const char *path,size_t *len){
  FILE *f=fopen(path,"rb");if(!f)return 0;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
  uint8_t *b=malloc(n);if(fread(b,1,n,f)!=(size_t)n){fclose(f);free(b);return 0;}fclose(f);*len=n;return b;
}
static void source(int kind,const char *path){size_t n;uint8_t *b=slurp(path,&n);if(b)core_source(kind,b,n);}
int main(void){
  source(CORE_MAP,"native/resources/map.pack");source(CORE_FIGURES,"native/resources/figures.bin");source(CORE_TABLES,"native/resources/tables.bin");
  source(CORE_GRIDS,getenv("FULLER_GRIDS")?getenv("FULLER_GRIDS"):"public/fuller.bin");source(CORE_LAND,getenv("LAND_BITS")?getenv("LAND_BITS"):"native/resources/land.pack");
  size_t cap=1<<16,len=0;char *text=malloc(cap);
  for(;;){if(len==cap){cap*=2;text=realloc(text,cap);}const size_t got=fread(text+len,1,cap-len,stdin);if(!got)break;len+=got;}
  hm_begin(getenv("HEAP_LIMIT")?(size_t)atol(getenv("HEAP_LIMIT")):0);
  core_allocator(hm_malloc,hm_release,hm_realloc);
  if(!core_build(text,len,0)){printf("{\"built\":false,\"why\":\"%s\",\"held\":%u}\n",core_failure(),(unsigned)hm_live);return 1;}
  const EnrScene *s=core_scene(0);
  // HEAP_BLOCKS=1 lists what the finished hour keeps (with a modelled heap).
  if(getenv("HEAP_BLOCKS")){for(int i=0;i<hm_n;i++)fprintf(stderr,"%s%u@%u ",hm_blocks[i].used?"":"free:",(unsigned)hm_blocks[i].size,(unsigned)hm_blocks[i].at);fprintf(stderr,"\n");}
  printf("{\"built\":true,\"peak\":%u,\"kept\":%u,\"runs\":%u",(unsigned)hm_peak,(unsigned)hm_live,(unsigned)s->row_offset[ENR_H]);
  // KEEP=1: the ground kept in memory (core_keep), the hour built again from
  // it: what it keeps written the first time and none the second, and each
  // minute it draws the first's.
  if(getenv("KEEP")){
    core_keep(1);
    uint8_t *a=malloc(ENR_W*ENR_H),*b=malloc(ENR_W*ENR_H);
    // (Built again to keep, as the first took none: then from what is kept.)
    core_build(text,len,2);const int written=core_kept();core_build(text,len,1);
    int differ=0;
    for(int m=0;m<60;m+=7){core_render(2,m,a);core_render(1,m,b);for(int i=0;i<ENR_W*ENR_H;i++)differ+=a[i]!=b[i];}
    printf(",\"kept_written\":%d,\"kept_again\":%d,\"kept_differ\":%d",written,core_kept()-written,differ);
    free(a);free(b);
  }
  printf("}\n");
  return 0;
}
