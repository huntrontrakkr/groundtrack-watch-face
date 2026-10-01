// Host check of the map pack decoder: decodes every tile of a mip and
// writes the cells (land bit << 4 | level, row by row, the mip's width and
// rows) to stdout, for tests/map-pack.test.mjs to compare with the
// JavaScript decoder's and the cells the pack was made from.
//   map_test <pack> <mip>
#include "../src/c/map_pack.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *slurp(const char *path,size_t *len){
  FILE *f=fopen(path,"rb");if(!f)return 0;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
  uint8_t *b=malloc(n);if(fread(b,1,n,f)!=(size_t)n){fclose(f);free(b);return 0;}fclose(f);*len=n;return b;
}
typedef struct {const uint8_t *data;size_t length;} Mem;
static size_t mem_read(void *src,uint32_t at,uint8_t *out,size_t n){Mem *m=src;if(at>=m->length)return 0;if(at+n>m->length)n=m->length-at;memcpy(out,m->data+at,n);return n;}
int main(int argc,char **argv){
  if(argc<3){fprintf(stderr,"usage: map_test pack mip\n");return 2;}
  size_t n=0;Mem m;m.data=slurp(argv[1],&n);m.length=n;
  if(!m.data){fprintf(stderr,"cannot read %s\n",argv[1]);return 2;}
  MapPack p;if(!map_pack_open(&p,mem_read,&m,malloc)){fprintf(stderr,"bad pack\n");return 2;}
  const int mip=atoi(argv[2]);if(mip<0||mip>=p.mips){fprintf(stderr,"no mip %d\n",mip);return 2;}
  const MapMip *q=&p.mip[mip];
  uint8_t *rows=malloc((size_t)q->width*q->rows),tile[MAP_TILE*MAP_TILE],buffer[256];
  for(int ty=0;ty<q->trows;ty++)for(int tx=0;tx<q->cols;tx++){
    if(!map_tile(&p,mip,tx,ty,tile,buffer)){fprintf(stderr,"tile %d,%d failed\n",tx,ty);return 1;}
    for(int cy=0;cy<MAP_TILE;cy++)for(int cx=0;cx<MAP_TILE;cx++){
      const int x=tx*MAP_TILE+cx,y=ty*MAP_TILE+cy;
      if(x<q->width&&y<q->rows)rows[(size_t)y*q->width+x]=tile[cy*MAP_TILE+cx];
    }
  }
  fwrite(rows,1,(size_t)q->width*q->rows,stdout);
  return 0;
}
