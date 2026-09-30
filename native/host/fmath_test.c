// Prints f_sin, f_cos, f_sqrt of |x|, f_fmod(x, 7.25), f_fmod(x*97, 5),
// f_asin and f_acos of s = x/800 (clamped to [-1, 1]), f_atan2(x, c) and
// f_atan(x) of each input line (a decimal double, then c), as 64-bit hex.
#include "../src/c/fmath.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>
int main(void){
  double x,c;
  while(scanf("%lf %lf",&x,&c)==2){
    double s=x/800;s=s<-1?-1:s>1?1:s;
    double v[9]={f_sin(x),f_cos(x),f_sqrt(x<0?-x:x),f_fmod(x,7.25),f_fmod(x*97,5),f_asin(s),f_acos(s),f_atan2(x,c),f_atan(x)};
    for(int i=0;i<9;i++){uint64_t u;memcpy(&u,&v[i],8);printf("%016llx ",(unsigned long long)u);}
    printf("\n");
  }
}
