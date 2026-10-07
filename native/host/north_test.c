// The north indicator follows a meridian on every face, after rotation.
#include "../src/c/fuller.h"
#include <stdio.h>
#include <math.h>
#include <assert.h>
static size_t read_grid(void *source,uint32_t at,uint8_t *out,size_t n){fseek(source,at,SEEK_SET);return fread(out,1,n,source);}
int main(void){
  FILE *file=fopen("public/fuller.bin","rb");assert(file);
  FullerConst g;uint8_t scratch[FULLER_HEADER];assert(fuller_const_read(read_grid,file,&g,scratch));fclose(file);
  for(int face=0;face<20;face++)for(int turn=0;turn<8;turn++){
    const double angle=turn*0.71;
    FullerCam c={.g=&g,.scale=100,.ux=cos(angle),.uy=sin(angle),.tile_count=1};
    FullerTile *tile=&c.tiles[0];tile->face=face;
    const double tri[3][2]={{0,0.5773502691896258},{0.5,-0.2886751345948129},{-0.5,-0.2886751345948129}};
    for(int i=0;i<3;i++)for(int j=0;j<2;j++)tile->tri[i][j]=tri[i][j];
    double x,y,dx,dy;fuller_north(&c,0,&x,&y,&dx,&dy);
    assert(fabs(x-100)<1e-6&&fabs(y-140)<1e-6);
    const double *n=g.bases[face],lat=asin(n[2])*180/acos(-1),lon=atan2(n[1],n[0])*180/acos(-1);
    double v[3],w[3],p[2]={0},nx,ny;
    fuller_direction(lat+0.0001,lon,v);fuller_forward(&g,face,v,w);
    for(int i=0;i<3;i++)for(int j=0;j<2;j++)p[j]+=w[i]*tri[i][j];
    fuller_to_screen(&c,p,&nx,&ny);const double length=hypot(nx-x,ny-y);
    assert((dx*(nx-x)+dy*(ny-y))/length>0.999999);
  }
  return 0;
}
