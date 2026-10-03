// A watch upgrade must preserve every old preference and ignore the old
// structure's padding, now the watch-state byte: an old record comes up
// with the vibration off and the fuel line on, and a new one keeps both.
#include "../src/c/watch_data.h"
#include <assert.h>
#include <string.h>

static uint8_t kept[sizeof(WatchSettings)];static int length;
int persist_read_data(const uint32_t key,void *out,const size_t size){
  assert(key==1&&size==sizeof kept);memcpy(out,kept,length);return length;
}
int persist_write_data(const uint32_t key,const void *bytes,const size_t size){
  assert(key==1&&size==sizeof kept);memcpy(kept,bytes,size);length=(int)size;return length;
}
int main(void){
  _Static_assert(sizeof(WatchSettings)==36,"the new switch fits the old settings record");
  WatchSettings old={.version=10,.body=BODY_SATELLITE,.plate=11,.readout=2,.clock24=0,.home=1,
    .lat100=4071,.lon100=-7401,.norad=25544,.station=1,.view=VIEW_WORLD,.code="ISS",
    .numerals=ENR_ACCENT,.zone_body=1,.tape=2,.transfer=3,.figures=3,.corner=2,.also=3,.bare=1,.legend=1,.watch=0xa5};
  length=sizeof old;memcpy(kept,&old,length);
  WatchSettings loaded;settings_load(&loaded);old.version=11;old.watch=0;
  assert(!memcmp(&old,&loaded,sizeof old));
  loaded.watch=3;settings_save(&loaded);settings_load(&old);assert(!memcmp(&old,&loaded,sizeof old)&&old.watch==3);
  for(int invalid=0;invalid<2;invalid++){
    length=invalid?sizeof kept:sizeof kept-1;memset(kept,0xff,sizeof kept);settings_load(&loaded);
    assert(loaded.version==11&&loaded.watch==0&&loaded.figures==2);
  }
  return 0;
}
