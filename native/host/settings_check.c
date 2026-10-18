// A watch upgrade must preserve every old preference and ignore the old
// structure's padding, now the watch-state byte: an old record comes up
// with the vibration off and the fuel line on, and a new one keeps both;
// a record from before the animations (version 13, 52 bytes) comes up with
// them as the defaults.
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
  _Static_assert(sizeof(WatchSettings)==56,"settings append the animations and the companions' kinds");
  WatchSettings old={.version=10,.body=BODY_SATELLITE,.plate=11,.readout=2,.clock24=0,.home=1,
    .lat100=4071,.lon100=-7401,.norad=25544,.station=1,.view=VIEW_WORLD,.code="ISS",
    .numerals=ENR_ACCENT,.zone_body=1,.tape=2,.transfer=3,.figures=3,.corner=2,.also=3,.bare=1,.legend=1,.watch=0xa5};
  length=36;memcpy(kept,&old,length);
  WatchSettings loaded;settings_load(&loaded);old.version=15;old.watch=0;old.fx=GT_FX_DEFAULT;old.fx_rate=GT_FX_RATE_DEFAULT;
  assert(!memcmp(&old,&loaded,sizeof old));
  loaded.watch=3;loaded.extra[0]=20580;loaded.extra[1]=48274;settings_save(&loaded);settings_load(&old);assert(!memcmp(&old,&loaded,sizeof old)&&old.watch==3);
  old.version=12;length=44;memcpy(kept,&old,length);settings_load(&loaded);old.version=15;
  assert(!memcmp(&old,&loaded,sizeof old));
  memcpy(loaded.extra_code,"HSTCSS",6);settings_save(&loaded);settings_load(&old);assert(!memcmp(&old,&loaded,sizeof old));
  // (Version 13's whole record: its settings kept, the animations the defaults.)
  old.version=13;old.fx=0;old.fx_rate=0;length=52;memcpy(kept,&old,length);settings_load(&loaded);old.version=15;old.fx=GT_FX_DEFAULT;old.fx_rate=GT_FX_RATE_DEFAULT;
  assert(!memcmp(&old,&loaded,sizeof old));
  loaded.fx=GT_FX_SORT|GT_FX_FLICK;loaded.fx_rate=3;settings_save(&loaded);settings_load(&old);assert(!memcmp(&old,&loaded,sizeof old));
  // (Version 14's, 56 bytes: its animations kept, the companions' kinds none.)
  old.version=14;old.extra_kind[0]=old.extra_kind[1]=7;length=56;memcpy(kept,&old,length);settings_load(&loaded);old.version=15;old.extra_kind[0]=old.extra_kind[1]=0;
  assert(!memcmp(&old,&loaded,sizeof old)&&loaded.fx==(GT_FX_SORT|GT_FX_FLICK));
  loaded.extra_kind[0]=2;loaded.extra_kind[1]=5;settings_save(&loaded);settings_load(&old);assert(!memcmp(&old,&loaded,sizeof old));
  for(int invalid=0;invalid<2;invalid++){
    length=invalid?sizeof kept:sizeof kept-1;memset(kept,0xff,sizeof kept);settings_load(&loaded);
    assert(loaded.version==15&&loaded.watch==0&&loaded.figures==2&&loaded.fx==GT_FX_DEFAULT);
  }
  return 0;
}
