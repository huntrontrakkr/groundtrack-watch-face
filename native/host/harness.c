#define _POSIX_C_SOURCE 199309L
// Host harness over the core: builds the hour from the input text on stdin
// (src/chart-input.js, as the phone would give the watch) and draws its
// minutes with the watch's own code.
//
//   harness -u          each minute drawn over the one before (and over a
//                       jump of five) against the minute drawn whole: prints
//                       the pixels that differ and the base pixels drawn
//                       (HARNESS_VERBOSE names each differing pixel)
//   harness -a          every minute's frame, whole, to stdout (GColor8)
//   harness -b          time an hour of minutes, a CPU proxy
//   harness <minute> [-o out.ppm]   one minute, as a PPM
// Resources come from native/resources and public/ (FULLER_GRIDS, LAND_BITS
// override the last two).
#include "core_api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static uint8_t *slurp(const char *path,size_t *len){
  FILE *f=fopen(path,"rb");if(!f)return 0;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
  uint8_t *b=malloc(n);if(fread(b,1,n,f)!=(size_t)n){fclose(f);free(b);return 0;}fclose(f);*len=n;return b;
}
static void source(int kind,const char *path){size_t n;uint8_t *b=slurp(path,&n);if(b)core_source(kind,b,n);}
int main(int argc,char **argv){
  if(argc<2){fprintf(stderr,"usage: harness -u | -a | -b | <minute> [-o out.ppm]  < input\n");return 2;}
  source(CORE_MAP,"native/resources/map.pack");source(CORE_FIGURES,"native/resources/figures.bin");source(CORE_TABLES,"native/resources/tables.bin");
  source(CORE_GRIDS,getenv("FULLER_GRIDS")?getenv("FULLER_GRIDS"):"public/fuller.bin");source(CORE_LAND,getenv("LAND_BITS")?getenv("LAND_BITS"):"native/resources/land.pack");
  // The input text, whole.
  size_t cap=1<<16,len=0;char *text=malloc(cap);
  for(;;){if(len==cap){cap*=2;text=realloc(text,cap);}const size_t got=fread(text+len,1,cap-len,stdin);if(!got)break;len+=got;}
  if(!core_build(text,len,0)){fprintf(stderr,"build failed (%s)\n",core_failure());return 1;}
  uint8_t *frame=malloc(ENR_W*ENR_H);
  if(!strcmp(argv[1],"-b")){
    struct timespec a,b;clock_gettime(CLOCK_MONOTONIC,&a);
    for(int rep=0;rep<10;rep++)for(int m=0;m<60;m++)core_render(0,m,frame);
    clock_gettime(CLOCK_MONOTONIC,&b);
    printf("{\"ms_per_minute\":%.3f}\n",((b.tv_sec-a.tv_sec)*1e3+(b.tv_nsec-a.tv_nsec)/1e6)/600);
    return 0;
  }
  if(!strcmp(argv[1],"-a")){for(int m=0;m<60;m++){core_render(0,m,frame);fwrite(frame,1,ENR_W*ENR_H,stdout);}return 0;}
  if(!strcmp(argv[1],"-u")){
    uint8_t *whole=malloc(ENR_W*ENR_H);long differ=0,drawn=0,updates=0;
    for(int m=1;m<60;m++)for(int step=1;step<=5;step+=4){
      if(m-step<0)continue;
      core_render(0,m-step,frame);drawn+=core_render_update(0,m-step,m,frame);updates++;
      core_render(0,m,whole);
      for(int i=0;i<ENR_W*ENR_H;i++)if(frame[i]!=whole[i]){differ++;if(getenv("HARNESS_VERBOSE"))fprintf(stderr,"minute %d step %d (%d,%d) update %02x whole %02x\n",m,step,i%ENR_W,i/ENR_W,frame[i],whole[i]);}
    }
    printf("{\"differ\":%ld,\"drawn\":%ld}\n",differ,drawn/updates);
    return 0;
  }
  const int minute=atoi(argv[1]);core_render(0,minute,frame);
  const char *ppm=argc>3&&!strcmp(argv[2],"-o")?argv[3]:NULL;
  if(ppm){FILE *o=fopen(ppm,"wb");fprintf(o,"P6 %d %d 255\n",ENR_W,ENR_H);for(int i=0;i<ENR_W*ENR_H;i++){const uint8_t c=frame[i];fputc((c>>4&3)*85,o);fputc((c>>2&3)*85,o);fputc((c&3)*85,o);}fclose(o);}
  printf("{\"minute\":%d}\n",minute);
  return 0;
}
