import numpy as np, sys, json
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
nlat=int(sys.argv[1]); nlon=2*nlat
mu,w=np.polynomial.legendre.leggauss(nlat); mu=mu[::-1]  # north to south
lat=np.degrees(np.arcsin(mu)); lon=np.arange(nlon)*360/nlon  # 0..360 east
# topography, 0.5 deg: rows lat -89.75..89.75, cols lon -179.75..179.75
d=np.loadtxt('etopo_half.csv',delimiter=',',skiprows=2,usecols=2).reshape(360,720)
d=d[::-1]  # north to south
tlat=89.75-0.5*np.arange(360); tlon=(-179.75+0.5*np.arange(720))%360
# blue marble: north from July, south from January
def lumgrid(fn):
    im=Image.open(fn).convert('RGB').resize((720,360),Image.BOX)
    a=np.asarray(im).astype(float)/255
    lin=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    return 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
lj=lumgrid('world.200407.3x5400x2700.jpg'); la=lumgrid('world.200401.3x5400x2700.jpg')
lum=np.where(tlat[:,None]>0,lj,la)   # image lon -180..180 matches tlon order
# per model cell: average over source cells within cell bounds
edges=np.concatenate([[90],np.degrees(np.arcsin(np.cumsum(w[::-1])[::-1]-1))[1:],[-90]]) if False else None
latb=np.zeros(nlat+1); latb[0]=90; latb[-1]=-90
cw=np.cumsum(w); # weights sum to 2 from north
for j in range(1,nlat): latb[j]=np.degrees(np.arcsin(1-cw[j-1]))
land=np.zeros((nlat,nlon)); zs=np.zeros((nlat,nlon)); zstd=np.zeros((nlat,nlon)); alb=np.zeros((nlat,nlon)); sheet=np.zeros((nlat,nlon))
dl=360/nlon
for j in range(nlat):
    rows=np.where((tlat<=latb[j])&(tlat>latb[j+1]))[0]
    for i in range(nlon):
        l0=lon[i]-dl/2; l1=lon[i]+dl/2
        cols=np.where(((tlon-l0)%360)<dl)[0]
        blk=d[np.ix_(rows,cols)]
        lm=blk>0
        land[j,i]=lm.mean()
        zz=np.maximum(blk,0); zs[j,i]=zz.mean(); zstd[j,i]=zz.std()
        lb=lum[np.ix_(rows,cols)]
        alb[j,i]=(lb[lm].mean() if lm.any() else 0.2)
        # ice sheets
        la_=lat[j]; lo_=((lon[i]+180)%360)-180
        if la_<-62 and land[j,i]>0.5: sheet[j,i]=1
        if 59<la_<84 and -74<lo_<-11 and land[j,i]>0.5 and not (62.5<la_<67.5 and -25.5<lo_<-12.5): sheet[j,i]=1
lm=(land>0.5).astype(float)
albl=np.clip(0.07+0.55*alb,0.08,0.38)
z0=np.clip(0.05+0.0015*zstd,0.05,1.5)
print('land frac %.3f'%(np.sum(lm*w[:,None])/np.sum(w)/nlon*nlon/nlon), 'sheet pts',int(sheet.sum()))
# SST / ice climatology to model grid (bilinear-ish nearest with fill)
sst=np.load('sst_clim.npy'); sic=np.load('sic_clim.npy')  # (12,90,180), lat 89.5..-89.5 step2? rows: 89.5,87.5..; lon -179.5..
slat=89.5-2*np.arange(90); slon=(-179.5+2*np.arange(180))%360
def regrid(f):
    out=np.zeros((12,nlat,nlon))
    for m in range(12):
        a=f[m].copy()
        # fill NaN by iterative neighbor averaging
        for it in range(200):
            nan=np.isnan(a)
            if not nan.any(): break
            p=np.pad(a,((1,1),(0,0)),mode='edge'); p=np.concatenate([p[:,-1:],p,p[:,:1]],axis=1)
            nb=np.stack([p[:-2,1:-1],p[2:,1:-1],p[1:-1,:-2],p[1:-1,2:]])
            m_=np.nanmean(np.where(np.isnan(nb),np.nan,nb),axis=0) if True else None
            a=np.where(nan&~np.isnan(m_),m_,a)
        # bilinear
        jj=np.interp(lat,slat[::-1],np.arange(90)[::-1])
        ii=((lon-slon[0])%360)/2
        j0=np.floor(jj).astype(int); j1=np.minimum(j0+1,89); fj=jj-j0
        i0=np.floor(ii).astype(int)%180; i1=(i0+1)%180; fi=ii-np.floor(ii)
        A=a[j0][:,i0]*(1-fi)+a[j0][:,i1]*fi; B=a[j1][:,i0]*(1-fi)+a[j1][:,i1]*fi
        out[m]=A*(1-fj[:,None])+B*fj[:,None]
    return out
import warnings; warnings.simplefilter('ignore')
SST=regrid(sst)+273.15; SIC=regrid(sic)
np.savez('surf_T%d.npz'%((2*nlat-1)//3 if nlat!=64 else 42),land=lm,landfrac=land,zs=zs,zstd=zstd,alb=albl,sheet=sheet,z0=z0,sst=SST,sic=SIC,lat=lat)
out={'nlat':nlat,'nlon':nlon,'land':lm.ravel().tolist(),'zs':np.round(zs,1).ravel().tolist(),'alb':np.round(albl,3).ravel().tolist(),'sheet':sheet.ravel().tolist(),'z0':np.round(z0,3).ravel().tolist(),
     'sst':np.round(SST,2).reshape(12,-1).tolist(),'sic':np.round(SIC,3).reshape(12,-1).tolist()}
json.dump(out,open('surf_%d.json'%nlat,'w'))
# print a coarse land map
for j in range(0,nlat,2): print(''.join('#' if sheet[j,i] else ('^' if zs[j,i]>1500 else ('+' if lm[j,i] else '.')) for i in range(0,nlon,1)))
