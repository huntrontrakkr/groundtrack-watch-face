// Prints f_sin, f_cos, f_sqrt of |x| and f_fmod(x, 7.25) and f_fmod(x*97, 5) of each
// input line (a decimal double), as 64-bit hex.
#include "../src/c/fmath.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>
int main(void){double x;while(scanf("%lf",&x)==1){double v[5]={f_sin(x),f_cos(x),f_sqrt(x<0?-x:x),f_fmod(x,7.25),f_fmod(x*97,5)};for(int i=0;i<5;i++){uint64_t u;memcpy(&u,&v[i],8);printf("%016llx ",(unsigned long long)u);}printf("\n");}}
