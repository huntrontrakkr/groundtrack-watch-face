// Prints f_sin and f_cos of each input line (a decimal double) as 64-bit hex.
#include "../src/c/fmath.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>
int main(void){double x;while(scanf("%lf",&x)==1){double v[2]={f_sin(x),f_cos(x)};for(int i=0;i<2;i++){uint64_t u;memcpy(&u,&v[i],8);printf("%016llx ",(unsigned long long)u);}printf("\n");}}
