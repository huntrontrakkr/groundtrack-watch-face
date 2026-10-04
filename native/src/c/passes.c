// See passes.h. Mirrors nextPass() and passText() in src/home.js and
// src/enroute-render.js.
#include "build_size.h"
#include "passes.h"
#include <string.h>

static int32_t le32(const uint8_t *p){return (int32_t)((uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24);}
static int le16(const uint8_t *p){return p[0]|p[1]<<8;}
static char *put(char *p,const char *s){while(*s)*p++=*s++;return p;}
static char *hhmm(char *p,int minutes){const int h=minutes/60,m=minutes%60;*p++=(char)('0'+h/10);*p++=(char)('0'+h%10);*p++=(char)('0'+m/10);*p++=(char)('0'+m%10);return p;}
static char *number(char *p,int v){char d[8];int n=0;if(v<0){*p++='-';v=-v;}do{d[n++]=(char)('0'+v%10);v/=10;}while(v);while(n)*p++=d[--n];return p;}
void pass_line_from(const uint8_t *b,size_t length,int64_t t,char out[24]){
  memset(out,0,24);
  char line[48],*p=put(line,"HOM ");
  const int count=length>=5?b[4]:0;
  const uint8_t *found=NULL;
  // The pass in progress at t, or the next rising within a day.
  for(int i=0;i<count&&5+(size_t)PASS_BYTES*(i+1)<=length;i++){
    const uint8_t *q=b+5+PASS_BYTES*i;
    if(le32(q+4)>=t&&le32(q)<=t+PASS_AHEAD_SECONDS){found=q;break;}
  }
  if(!found)p=put(p,"NO PASS");
  else if(le32(found)<=t){p=put(p,"IN VIEW LOS ");p=hhmm(p,le16(found+12));}
  else{
    const int32_t d=le32(found+4)-le32(found);int minutes=(d+30)/60;if(minutes<1)minutes=1;
    p=put(p,"AOS ");p=hhmm(p,le16(found+10));*p++=' ';p=number(p,minutes);p=put(p,"M ");
    p=number(p,(int16_t)le16(found+8));*p++=(char)0x7f;
  }
  const size_t n=(size_t)(p-line);memcpy(out,line,n<24?n:24);
}
