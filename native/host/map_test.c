// Host check of the map pack decoder: decode rows of a pack and compare them
// with the relief grid and land atlas they came from. Prints one JSON line.
//   map_test <pack> <relief.bin> <land.bin> [row0 row1]
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
typedef struct {const uint8_t *relief,*land;long rows,differ;int first_bad;} Check;
static void row(void *ctx,int y,const uint8_t *relief,const uint8_t *land){
  Check *c=ctx;c->rows++;
  for(int x=0;x<MAP_WIDTH;x++){
    const long i=(long)y*MAP_WIDTH+x;const int bit=(c->land[i>>3]>>(i&7))&1;
    if(relief[x]!=c->relief[i]||land[x]!=bit){c->differ++;if(c->first_bad<0)c->first_bad=y;}
  }
}
int main(int argc,char **argv){
  if(argc<4){fprintf(stderr,"usage: map_test pack relief.bin land.bin [row0 row1]\n");return 2;}
  size_t n,rn,ln;Mem m;m.data=slurp(argv[1],&n);m.length=n;
  const uint8_t *relief=slurp(argv[2],&rn),*land=slurp(argv[3],&ln);
  if(!m.data||!relief||!land){fprintf(stderr,"cannot read inputs\n");return 2;}
  MapPack p;if(!map_pack_open(&p,mem_read,&m)){fprintf(stderr,"bad pack\n");return 2;}
  const int r0=argc>5?atoi(argv[4]):p.first,r1=argc>5?atoi(argv[5]):p.first+p.rows;
  static MapWork work;Check c={relief,land,0,0,-1};
  if(!map_pack_rows(&p,&work,r0,r1,row,&c)){fprintf(stderr,"decode failed\n");return 2;}
  printf("{\"rows\":%ld,\"differ\":%ld,\"first_bad_row\":%d,\"pack_bytes\":%zu}\n",c.rows,c.differ,c.first_bad,n);
  return c.differ?1:0;
}
