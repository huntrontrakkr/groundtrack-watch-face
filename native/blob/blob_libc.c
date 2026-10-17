// The few functions of the C library the code blobs use (tools/build-blobs.py):
// they carry no library but libgcc's arithmetic. malloc and free are the app's,
// handed over by the entry table's init. Built into each blob.
#include <stddef.h>
#include <stdint.h>

static void *(*s_alloc)(size_t);
static void (*s_release)(void *);
void blob_allocator(void *(*alloc)(size_t),void (*release)(void *)){s_alloc=alloc;s_release=release;}
void *malloc(size_t n){return s_alloc(n);}
void free(void *p){s_release(p);}
void *memcpy(void *d,const void *s,size_t n){uint8_t *a=d;const uint8_t *b=s;while(n--)*a++=*b++;return d;}
void *memmove(void *d,const void *s,size_t n){
  uint8_t *a=d;const uint8_t *b=s;
  if(a<b)while(n--)*a++=*b++;else{a+=n;b+=n;while(n--)*--a=*--b;}
  return d;
}
void *memset(void *d,int c,size_t n){uint8_t *a=d;while(n--)*a++=(uint8_t)c;return d;}
int memcmp(const void *a,const void *b,size_t n){
  const uint8_t *p=a,*q=b;
  for(;n;n--,p++,q++)if(*p!=*q)return *p-*q;
  return 0;
}
size_t strlen(const char *s){const char *p=s;while(*p)p++;return (size_t)(p-s);}
