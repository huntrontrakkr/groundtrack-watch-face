// Builds the hour from the input text on stdin with the watch's chart
// builder and reports what the build took: its peak memory, counted as the
// watch's heap would (each block with 8 bytes of the allocator's own), and
// what the finished hour keeps. HEAP_LIMIT fails allocations past it, as a
// watch out of memory would.
//   build_check < input
#include "core_api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t live,peak,limit;
static void *counted(size_t n){if(limit&&live+n+8>limit)return 0;size_t *p=malloc(n+sizeof(size_t));if(!p)return 0;*p=n;live+=n+8;if(live>peak)peak=live;return p+1;}
static void uncounted(void *q){if(!q)return;size_t *p=(size_t *)q-1;live-=*p+8;free(p);}
static void *recounted(void *q,size_t n){if(!q)return counted(n);size_t *p=(size_t *)q-1;const size_t old=*p;p=realloc(p,n+sizeof(size_t));if(!p)return 0;live=live-old+n;if(live>peak)peak=live;*p=n;return p+1;}
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
  if(getenv("HEAP_LIMIT"))limit=(size_t)atol(getenv("HEAP_LIMIT"));
  core_allocator(counted,uncounted,recounted);
  if(!core_build(text,len,0)){printf("{\"built\":false,\"why\":\"%s\",\"held\":%u}\n",core_failure(),(unsigned)live);return 1;}
  const EnrScene *s=core_scene(0);
  printf("{\"built\":true,\"peak\":%u,\"kept\":%u,\"runs\":%u}\n",(unsigned)peak,(unsigned)live,(unsigned)s->row_offset[ENR_H]);
  return 0;
}
