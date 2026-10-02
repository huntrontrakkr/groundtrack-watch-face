// The watch's heap, modelled: a fixed stretch of bytes cut into blocks in
// address order, each with 8 bytes of the allocator's own; an allocation
// takes the lowest free block that holds it (first fit) and leaves the rest
// free; a freed block joins its free neighbours; a reallocation is a new
// block, a copy and a free. So a build that leaves the heap in pieces fails
// here as it does on the watch, where counting bytes alone would pass it.
//
// The blocks themselves come from the host's allocator (each with its place
// in the model before it), so the sanitizers still watch their bounds.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {uint32_t at,size;uint8_t used;} HeapBlock;
#define HEAP_BLOCKS 1024
static HeapBlock hm_blocks[HEAP_BLOCKS];static int hm_n;
static size_t hm_size,hm_live,hm_peak;
// The model's size in bytes (0: no limit, and no model of where blocks lie).
static void hm_begin(size_t size){hm_size=size&~(size_t)7;hm_n=1;hm_blocks[0]=(HeapBlock){0,(uint32_t)hm_size,0};hm_live=hm_peak=0;}
static size_t hm_free_bytes(void){return hm_size>hm_live?hm_size-hm_live:0;}
// The largest allocation that would succeed now.
static size_t hm_largest(void){uint32_t best=0;for(int i=0;i<hm_n;i++)if(!hm_blocks[i].used&&hm_blocks[i].size>best)best=hm_blocks[i].size;return best>8?best-8:0;}
typedef struct {size_t n;uint32_t at;uint32_t pad;} HeapHeader;
static void *hm_malloc(size_t n){
  const uint32_t need=(uint32_t)((n+7)&~(size_t)7)+8;uint32_t at=0;
  if(hm_size){
    int i=0;while(i<hm_n&&(hm_blocks[i].used||hm_blocks[i].size<need))i++;
    if(i==hm_n)return NULL;
    if(hm_blocks[i].size>need){
      if(hm_n==HEAP_BLOCKS)return NULL;
      memmove(hm_blocks+i+1,hm_blocks+i,sizeof(HeapBlock)*(size_t)(hm_n-i));hm_n++;
      hm_blocks[i+1].at=hm_blocks[i].at+need;hm_blocks[i+1].size=hm_blocks[i].size-need;hm_blocks[i+1].used=0;hm_blocks[i].size=need;
    }
    hm_blocks[i].used=1;at=hm_blocks[i].at;
  }
  HeapHeader *h=malloc(sizeof(HeapHeader)+n);if(!h)return NULL;
  h->n=n;h->at=at;hm_live+=need;if(hm_live>hm_peak)hm_peak=hm_live;
  return h+1;
}
static void hm_release(void *p){
  if(!p)return;
  HeapHeader *h=(HeapHeader *)p-1;hm_live-=(uint32_t)((h->n+7)&~(size_t)7)+8;
  if(hm_size){
    int i=0;while(i<hm_n&&hm_blocks[i].at!=h->at)i++;
    if(i==hm_n||!hm_blocks[i].used)abort();
    hm_blocks[i].used=0;
    if(i+1<hm_n&&!hm_blocks[i+1].used){hm_blocks[i].size+=hm_blocks[i+1].size;memmove(hm_blocks+i+1,hm_blocks+i+2,sizeof(HeapBlock)*(size_t)(hm_n-i-2));hm_n--;}
    if(i>0&&!hm_blocks[i-1].used){hm_blocks[i-1].size+=hm_blocks[i].size;memmove(hm_blocks+i,hm_blocks+i+1,sizeof(HeapBlock)*(size_t)(hm_n-i-1));hm_n--;}
  }
  free(h);
}
static void *hm_realloc(void *p,size_t n){
  if(!p)return hm_malloc(n);
  void *q=hm_malloc(n);if(!q)return NULL;
  const size_t old=((HeapHeader *)p-1)->n;memcpy(q,p,old<n?old:n);hm_release(p);return q;
}
