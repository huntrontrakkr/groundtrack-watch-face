// Rolling Fuller on the watch. See fuller.h. Each function names the
// JavaScript it mirrors, and follows it operation for operation (fmath.c's
// arctangent, JavaScript's evaluation order); build without fused
// multiply-adds.
#include "fuller.h"
#include "fmath.h"
#include <math.h>
#include <string.h>

#define W 200
#define H 228
#define TRACK_Y 140
#define PI 3.14159265358979323846
static const double RAD=PI/180;
static const int EDGES[3][2]={{0,1},{1,2},{2,0}};

// JavaScript's Math.round.
static double js_round(double v){const double r=floor(v);return v-r>=0.5?r+1:r;}
static double dot3(const double *a,const double *b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
static double hypot2(double x,double y){return f_sqrt(x*x+y*y);}

static double le64(const uint8_t *p){uint64_t v=0;for(int k=7;k>=0;k--)v=v<<8|p[k];double d;memcpy(&d,&v,8);return d;}
bool fuller_const_read(MapReadFn read,void *source,FullerConst *g){
  uint8_t h[FULLER_HEADER];
  if(read(source,0,h,FULLER_HEADER)!=FULLER_HEADER||memcmp(h,"GTF1",4))return false;
  const uint8_t *p=h+8;
  g->S3=le64(p);g->Z=le64(p+8);g->EL=le64(p+16);g->DVE=le64(p+24);g->RAW_EDGE=le64(p+32);p+=40;
  for(int f=0;f<20;f++)for(int k=0;k<9;k++){g->bases[f][k]=le64(p);p+=8;}
  memcpy(g->F,p,60);memcpy(g->NB,p+60,60);
  for(int f=0;f<20;f++)for(int k=0;k<3;k++)if(g->F[f][k]>=12||g->NB[f][k]>=20)return false;
  return true;
}

void fuller_direction(double lat,double lon,double d[3]){
  const double a=lat*RAD,b=lon*RAD;
  d[0]=f_cos(a)*f_cos(b);d[1]=f_cos(a)*f_sin(b);d[2]=f_sin(a);
}
// faceOf(): the face whose centre is nearest, the first on a tie.
int fuller_face_of(const FullerConst *g,const double d[3]){
  int best=0;double score=-INFINITY;
  for(int f=0;f<20;f++){const double s=dot3(d,g->bases[f]);if(s>score){score=s;best=f;}}
  return best;
}
// raw(): the Gray-Fuller transform of a point on the face's plane.
static void raw(const FullerConst *g,double x,double y,double out[2]){
  const double a=f_atan2(2*y/g->S3-g->EL/6,g->DVE),b=f_atan2(x-y/g->S3-g->EL/6,g->DVE),c=f_atan2(-x-y/g->S3-g->EL/6,g->DVE);
  out[0]=g->S3*(b-c);out[1]=2*a-b-c;
}
// forwardFace(): a direction's weights on a face.
void fuller_forward(const FullerConst *g,int face,const double d[3],double w[3]){
  const double *b=g->bases[face],scale=g->Z/dot3(d,b);double r[2];
  raw(g,dot3(d,b+3)*scale,dot3(d,b+6)*scale,r);
  const double x=r[0]/g->RAW_EDGE,y=r[1]/g->RAW_EDGE,a=(y+1/(2*g->S3))*2/g->S3;
  w[0]=a;w[1]=(1-a)/2+x;w[2]=(1-a)/2-x;
}
// flatPoint(): weights to the plane, on a printed triangle.
static void flat_point(const double w[3],const double tri[3][2],double p[2]){
  for(int k=0;k<2;k++){double s=0;for(int i=0;i<3;i++)s=s+w[i]*tri[i][k];p[k]=s;}
}
// A triangle's key: its centre, to the millionth.
static void key_of(const double tri[3][2],int64_t key[2]){
  for(int k=0;k<2;k++){double s=0;for(int i=0;i<3;i++)s=s+tri[i][k]/3;key[k]=(int64_t)js_round(s*1e6);}
}
static void centre(const double tri[3][2],double c[2]){for(int k=0;k<2;k++){double s=0;for(int i=0;i<3;i++)s=s+tri[i][k]/3;c[k]=s;}}
// unfold.js across(): the face across an edge, printed on its reflection.
static void across(const FullerConst *g,const FullerCell *t,int edge,FullerCell *out){
  const int a=EDGES[edge][0],b=EDGES[edge][1],other=a!=0&&b!=0?0:a!=1&&b!=1?1:2;
  const double *p=t->tri[a],*q=t->tri[b],*r=t->tri[other];
  const double dx=q[0]-p[0],dy=q[1]-p[1],s=((r[0]-p[0])*dx+(r[1]-p[1])*dy)/(dx*dx+dy*dy);
  const double reflected[2]={2*(p[0]+s*dx)-r[0],2*(p[1]+s*dy)-r[1]};
  const int face=g->NB[t->face][edge];
  for(int i=0;i<3;i++){
    const int v=g->F[face][i];
    const double *c=v==g->F[t->face][a]?p:v==g->F[t->face][b]?q:reflected;
    out->tri[i][0]=c[0];out->tri[i][1]=c[1];
  }
  out->face=(uint8_t)face;out->route=false;key_of(out->tri,out->key);
}
static int find(const FullerCell *cells,int n,const int64_t key[2]){
  for(int i=0;i<n;i++)if(cells[i].key[0]==key[0]&&cells[i].key[1]==key[1])return i;
  return -1;
}
void fuller_to_screen(const FullerCam *cam,const double p[2],double *x,double *y){
  const double dx=p[0]-cam->mid[0],dy=p[1]-cam->mid[1];
  *x=W/2+(dx*cam->ux+dy*cam->uy)*cam->scale;*y=TRACK_Y-(-dx*cam->uy+dy*cam->ux)*cam->scale;
}
void fuller_to_plane(const FullerCam *cam,double x,double y,double p[2]){
  const double s=(x-W/2)/cam->scale,t=(TRACK_Y-y)/cam->scale;
  p[0]=cam->mid[0]+s*cam->ux-t*cam->uy;p[1]=cam->mid[1]+s*cam->uy+t*cam->ux;
}
static bool on_screen(const FullerCam *cam,const double tri[3][2]){
  double x0=INFINITY,x1=-INFINITY,y0=INFINITY,y1=-INFINITY;
  for(int i=0;i<3;i++){double x,y;fuller_to_screen(cam,tri[i],&x,&y);x0=x<x0?x:x0;x1=x>x1?x:x1;y0=y<y0?y:y0;y1=y>y1?y:y1;}
  return x1>-2&&x0<W+2&&y1>-2&&y0<H+2;
}
// roll.js rollTo(): from one face to the face holding d, an edge at a time.
static void roll_to(const FullerConst *g,FullerCell *tile,const double d[3]){
  for(int guard=0;guard<6&&tile->face!=fuller_face_of(g,d);guard++){
    const int target=fuller_face_of(g,d);int direct=-1;
    for(int e=0;e<3;e++)if(g->NB[tile->face][e]==target){direct=e;break;}
    int edge=direct;
    if(direct<0){edge=0;for(int e=1;e<3;e++)if(dot3(g->bases[g->NB[tile->face][e]],d)>dot3(g->bases[g->NB[tile->face][edge]],d))edge=e;}
    FullerCell next;across(g,tile,edge,&next);*tile=next;
  }
}
// rollCamera().
bool fuller_roll(FullerCam *cam,FullerCell *cells,const FullerConst *g,const double (*dirs)[3],int count,int i0,int i1,bool day,double span,double *xs,double *ys){
  memset(cam,0,sizeof *cam);cam->g=g;int cell_count=0;
  const double S3=g->S3;
  FullerCell tile;memset(&tile,0,sizeof tile);
  tile.face=(uint8_t)fuller_face_of(g,dirs[0]);
  tile.tri[0][0]=0;tile.tri[0][1]=1/S3;tile.tri[1][0]=.5;tile.tri[1][1]=-1/(2*S3);tile.tri[2][0]=-.5;tile.tri[2][1]=-1/(2*S3);
  key_of(tile.tri,tile.key);
  // The route's printing wins its cells; each point on its face, in the
  // plane (kept in xs, ys for now).
  int path_from=0;
  for(int i=0;i<count;i++){
    roll_to(g,&tile,dirs[i]);
    if(find(cells,cell_count,tile.key)<0){if(cell_count>=FULLER_CELLS)return false;cells[cell_count]=tile;cells[cell_count].route=true;cell_count++;}
    double w[3],p[2];fuller_forward(g,tile.face,dirs[i],w);flat_point(w,tile.tri,p);xs[i]=p[0];ys[i]=p[1];
  }
  const int path_n=cell_count;
  const int ia=day?0:i0,ib=day?count-1:i1;
  const double a[2]={xs[ia],ys[ia]},b[2]={xs[ib],ys[ib]};
  const double len=hypot2(b[0]-a[0],b[1]-a[1]);
  cam->ux=(b[0]-a[0])/len;cam->uy=(b[1]-a[1])/len;cam->scale=span/len;cam->mid[0]=(a[0]+b[0])/2;cam->mid[1]=(a[1]+b[1])/2;
  if(day){
    // Fit the whole day's arc, and centre it.
    double s0=INFINITY,s1=-INFINITY,t0=INFINITY,t1=-INFINITY;
    for(int i=0;i<count;i++){
      const double rs=xs[i]*cam->ux+ys[i]*cam->uy,rt=-xs[i]*cam->uy+ys[i]*cam->ux;
      s0=rs<s0?rs:s0;s1=rs>s1?rs:s1;t0=rt<t0?rt:t0;t1=rt>t1?rt:t1;
    }
    const double fs=span/(s1-s0),dt=t1-t0,ft=110/(1e-9>dt?1e-9:dt);cam->scale=fs<ft?fs:ft;
    const double sc=(s0+s1)/2,tc=(t0+t1)/2;cam->mid[0]=sc*cam->ux-tc*cam->uy;cam->mid[1]=sc*cam->uy+tc*cam->ux;
  }
  // The floating net: two rings of faces round the route, nearest the
  // middle of the hour first, each face at most once and only where it truly
  // meets every face printed beside it.
  bool printed[20]={false};
  for(int i=0;i<path_n;i++)printed[cells[i].face]=true;
  double mx,my;{const double m[2]={(a[0]+b[0])/2,(a[1]+b[1])/2};fuller_to_screen(cam,m,&mx,&my);}
  int frontier_from=path_from,frontier_to=path_n;
  for(int ring=0;ring<2;ring++){
    FullerCell cand[FULLER_CELLS];double dist[FULLER_CELLS];int nc=0;
    for(int k=frontier_from;k<frontier_to;k++)for(int e=0;e<3;e++){
      FullerCell n;across(g,&cells[k],e,&n);
      if(find(cells,cell_count,n.key)>=0||printed[n.face]||!on_screen(cam,n.tri))continue;
      if(nc>=FULLER_CELLS)return false;
      double c[2],x,y;centre(n.tri,c);fuller_to_screen(cam,c,&x,&y);
      // Sorted as it goes, stably, by distance from the middle.
      const double d=hypot2(x-mx,y-my);int j=nc;
      while(j>0&&dist[j-1]>d){cand[j]=cand[j-1];dist[j]=dist[j-1];j--;}
      cand[j]=n;dist[j]=d;nc++;
    }
    const int added_from=cell_count;
    for(int k=0;k<nc;k++){
      FullerCell t=cand[k];
      if(find(cells,cell_count,t.key)>=0||printed[t.face])continue;
      bool fits=true;
      for(int e=0;e<3&&fits;e++){FullerCell m;across(g,&t,e,&m);const int there=find(cells,cell_count,m.key);if(there>=0&&cells[there].face!=m.face)fits=false;}
      if(!fits)continue;
      if(cell_count>=FULLER_CELLS)return false;
      cells[cell_count++]=t;printed[t.face]=true;
    }
    frontier_from=added_from;frontier_to=cell_count;
  }
  // The tiles on the screen: their triangles, boxes and edges.
  for(int i=0;i<cell_count;i++){
    if(!on_screen(cam,cells[i].tri))continue;
    if(cam->tile_count>=FULLER_TILES)return false;
    FullerTile *t=&cam->tiles[cam->tile_count++];memcpy(t->tri,cells[i].tri,sizeof t->tri);t->face=cells[i].face;
    double x0=INFINITY,x1=-INFINITY,y0=INFINITY,y1=-INFINITY;
    for(int k=0;k<3;k++){double x,y;fuller_to_screen(cam,cells[i].tri[k],&x,&y);x0=x<x0?x:x0;x1=x>x1?x:x1;y0=y<y0?y:y0;y1=y>y1?y:y1;}
    t->box[0]=x0;t->box[1]=y0;t->box[2]=x1;t->box[3]=y1;
    for(int e=0;e<3;e++){
      FullerCell n;across(g,&cells[i],e,&n);const int there=find(cells,cell_count,n.key);
      t->edge[e]=(uint8_t)(there<0?2:cells[there].face!=n.face?1:0);
    }
  }
  // The track on the screen.
  for(int i=0;i<count;i++){const double p[2]={xs[i],ys[i]};fuller_to_screen(cam,p,&xs[i],&ys[i]);}
  return true;
}
// fuller.js barycentric().
static void barycentric(const double p[2],const double tri[3][2],double w[3]){
  const double *a=tri[0],*b=tri[1],*c=tri[2];
  const double dx=p[0]-a[0],dy=p[1]-a[1],d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const double u=(dx*(c[1]-a[1])-dy*(c[0]-a[0]))/d,v=((b[0]-a[0])*dy-(b[1]-a[1])*dx)/d;
  w[0]=1-u-v;w[1]=u;w[2]=v;
}
// roll.js locate().
int fuller_locate(const FullerCam *cam,double x,double y,double w[3]){
  double p[2],ww[3];fuller_to_plane(cam,x,y,p);
  for(int t=0;t<cam->tile_count;t++){
    const double *b=cam->tiles[t].box;
    if(x<b[0]-1||x>b[2]+1||y<b[1]-1||y>b[3]+1)continue;
    barycentric(p,cam->tiles[t].tri,ww);
    if(ww[0]>=-1e-9&&ww[1]>=-1e-9&&ww[2]>=-1e-9){if(w){w[0]=ww[0];w[1]=ww[1];w[2]=ww[2];}return t;}
  }
  return -1;
}
// roll.js project().
void fuller_project(const FullerCam *cam,double lat,double lon,double *x,double *y){
  double d[3],w[3];fuller_direction(lat,lon,d);const int face=fuller_face_of(cam->g,d);fuller_forward(cam->g,face,d,w);
  bool have=false;double best=0;*x=-999;*y=-999;
  for(int t=0;t<cam->tile_count;t++){
    const FullerTile *c=&cam->tiles[t];if(c->face!=face)continue;
    double p[2],qx,qy;flat_point(w,c->tri,p);fuller_to_screen(cam,p,&qx,&qy);
    const double dd=hypot2(qx-W/2,qy-TRACK_Y);
    if(!have||dd<best){have=true;best=dd;*x=qx;*y=qy;}
  }
}
void fuller_tile_grid(const FullerCam *cam,int tile,int n,int32_t out[6]){
  const double (*tri)[2]=cam->tiles[tile].tri;
  double at[3][2];const double pts[3][2]={{0,0},{1,0},{0,1}};
  for(int k=0;k<3;k++){double p[2],w[3];fuller_to_plane(cam,pts[k][0],pts[k][1],p);barycentric(p,tri,w);at[k][0]=w[1]*n;at[k][1]=w[2]*n;}
  for(int k=0;k<2;k++){
    out[3*k]=(int32_t)js_round(at[0][k]*65536);out[3*k+1]=(int32_t)js_round((at[1][k]-at[0][k])*16384);out[3*k+2]=(int32_t)js_round((at[2][k]-at[0][k])*16384);
  }
}
