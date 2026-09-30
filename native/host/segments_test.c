// Evaluates segments as the watch does and prints each value's exact bits,
// for comparison with the JavaScript: reads lines "<segment hex> <seconds>"
// on stdin, prints "<sun lat> <sun lon> <moon lat> <moon lon> <fraction> <waxing>",
// each double as its 64 bits in hex.
#include "../src/c/segments.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
  static char line[4096];
  while(fgets(line,sizeof line,stdin)){
    char hex[2*SEG_BYTES+2];long long seconds;
    if(sscanf(line,"%1100s %lld",hex,&seconds)!=2)continue;
    uint8_t b[SEG_BYTES];for(int i=0;i<SEG_BYTES;i++){unsigned v;sscanf(hex+2*i,"%2x",&v);b[i]=(uint8_t)v;}
    Segment s;seg_decode(b,&s);double a,o,c,d,f;bool w;
    seg_position(&s,false,seconds,&a,&o);seg_position(&s,true,seconds,&c,&d);seg_moon_light(&s,seconds,&f,&w);
    const double v[5]={a,o,c,d,f};
    for(int i=0;i<5;i++){unsigned long long u;memcpy(&u,&v[i],8);printf("%016llx ",u);}
    printf("%d\n",w);
  }
  return 0;
}
