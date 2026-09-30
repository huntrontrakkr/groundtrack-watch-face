#define _POSIX_C_SOURCE 199309L
// Host test harness: parse a scene exported by tools/export-scene.mjs, draw
// the requested minutes with the native core, and compare each frame with
// the browser renderer's reference frame. Prints one JSON line per frame.
//
//   harness <scene> <reference prefix> <minute>...   (optional: -o out.ppm)
#include "../src/c/enroute_core.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static uint8_t *slurp(const char *path,size_t *len){
  FILE *f=fopen(path,"rb");if(!f)return 0;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
  uint8_t *b=malloc(n);if(fread(b,1,n,f)!=(size_t)n){fclose(f);free(b);return 0;}fclose(f);*len=n;return b;
}
int main(int argc,char **argv){
  if(argc<4){fprintf(stderr,"usage: harness scene refprefix minute... [-o out.ppm]\n");return 2;}
  size_t len;uint8_t *blob=slurp(argv[1],&len);if(!blob){fprintf(stderr,"cannot read %s\n",argv[1]);return 2;}
  EnrScene *scene=malloc(sizeof *scene);
  if(!enr_parse(blob,len,scene,malloc,false)){fprintf(stderr,"malformed scene %s\n",argv[1]);return 2;}
  uint8_t *frame=malloc(ENR_W*ENR_H);int failed=0;const char *ppm=0;
  // -b: time a whole hour of minutes, as a CPU proxy (not a watch measurement).
  if(!strcmp(argv[3],"-b")){
    struct timespec a,b;clock_gettime(CLOCK_MONOTONIC,&a);
    for(int rep=0;rep<10;rep++)for(int m=0;m<60;m++)enr_render(scene,m,frame,ENR_W);
    clock_gettime(CLOCK_MONOTONIC,&b);
    printf("{\"ms_per_minute\":%.3f}\n",((b.tv_sec-a.tv_sec)*1e3+(b.tv_nsec-a.tv_nsec)/1e6)/600);
    return 0;
  }
  // -a: every minute's frame, whole, to stdout (for comparing builds).
  if(!strcmp(argv[3],"-a")){for(int m=0;m<60;m++){enr_render(scene,m,frame,ENR_W);fwrite(frame,1,ENR_W*ENR_H,stdout);}return 0;}
  // -u: each minute drawn over the previous one (enr_render_update) must be
  // the minute drawn whole; also a jump of five. Prints the pixels that
  // differ and the base pixels drawn, per update, on average.
  if(!strcmp(argv[3],"-u")){
    uint8_t *whole=malloc(ENR_W*ENR_H);long differ=0,drawn=0,updates=0;
    for(int m=1;m<60;m++)for(int step=1;step<=5;step+=4){
      if(m-step<0)continue;
      enr_render(scene,m-step,frame,ENR_W);drawn+=enr_render_update(scene,m-step,m,frame,ENR_W);updates++;
      enr_render(scene,m,whole,ENR_W);
      for(int i=0;i<ENR_W*ENR_H;i++)if(frame[i]!=whole[i])differ++;
    }
    printf("{\"differ\":%ld,\"drawn\":%ld}\n",differ,drawn/updates);
    return 0;
  }
  for(int a=3;a<argc;a++){
    if(!strcmp(argv[a],"-o")&&a+1<argc){ppm=argv[++a];continue;}
    const int minute=atoi(argv[a]);
    enr_render(scene,minute,frame,ENR_W);
    char path[512];snprintf(path,sizeof path,"%s-%02d.rgb",argv[2],minute);
    size_t rlen;uint8_t *ref=slurp(path,&rlen);
    if(!ref||rlen!=ENR_W*ENR_H*3){fprintf(stderr,"missing reference %s\n",path);return 2;}
    int differ=0,first=-1;
    for(int i=0;i<ENR_W*ENR_H;i++){
      const uint8_t c=frame[i],rgb[3]={(c>>4&3)*85,(c>>2&3)*85,(c&3)*85};
      if(memcmp(rgb,ref+i*3,3)){differ++;if(first<0)first=i;}
    }
    printf("{\"minute\":%d,\"differ\":%d,\"first\":[%d,%d]}\n",minute,differ,first<0?-1:first%ENR_W,first<0?-1:first/ENR_W);
    if(differ)failed++;
    if(ppm){FILE *o=fopen(ppm,"wb");fprintf(o,"P6 %d %d 255\n",ENR_W,ENR_H);for(int i=0;i<ENR_W*ENR_H;i++){const uint8_t c=frame[i];fputc((c>>4&3)*85,o);fputc((c>>2&3)*85,o);fputc((c&3)*85,o);}fclose(o);}
    free(ref);
  }
  enr_free(scene,free);free(scene);free(blob);free(frame);
  return 0;
}
