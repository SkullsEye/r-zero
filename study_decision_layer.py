import sys, json
import numpy as np, pandas as pd
sys.path.insert(0, "/root/ship")
from rzero.queue import ReviewDesk
from rzero.sequential import EvidenceScale, SequentialTest
d = pd.read_csv("/root/data/ieee_slim.csv", low_memory=False)
t0=d.TransactionDT.min(); day=(d.TransactionDT.values-t0)/86400.0
y=d.isFraud.values.astype(int); amt=d.TransactionAmt.values.astype(float)*83.0
d["D1n"]=(day-d.D1.fillna(-999).values).round(0)
client=(d.card1.astype(str)+"_"+d.addr1.astype(str)+"_"+d.D1n.astype(str)).astype(str).values
val_m=(day>=90)&(day<120); test_m=day>=120
sv,st=np.load("final_scores_val.npy"),np.load("final_scores_test.npy")
yv,yt=y[val_m],y[test_m]; cv,ct=client[val_m],client[test_m]
dv,dt=day[val_m],day[test_m]; at_=amt[test_m]
rank=lambda v: v.argsort().argsort()/max(len(v)-1,1); rv,rt=rank(sv),rank(st)
truth=pd.DataFrame({"c":ct,"y":yt}).groupby("c").y.max().to_dict()
clean_set={k for k,v in truth.items() if v==0}
span=dt.max()-dt.min(); clean_txn=sum(1 for c in ct if c in clean_set)
def run_desk(cap, hrs, acc=1.0, seed=0):
    rng=np.random.default_rng(seed)
    desk=ReviewDesk(cap, hrs/24.0, 1.0, seconds_per_day=1.0)
    hit=np.zeros(len(dt),np.int8)
    for i in range(len(dt)):
        for k in desk.due(dt[i]):
            v=truth.get(k,0)==1
            if rng.random()>=acc: v=not v
            desk.verdict(k,v)
        if desk.decide(dt[i], ct[i], rt[i])!="allow": hit[i]=1
    return hit
def metrics(hit):
    per={}
    for c,h in zip(ct,hit):
        if h and c in clean_set: per[c]=per.get(c,0)+1
    g=pd.DataFrame({"c":ct,"h":hit,"y":yt}).groupby("c").agg(h=("h","max"),f=("y","max"))
    return dict(stopped=len(per)/span, txn=sum(per.values())/clean_txn,
                worst=max(per.values()) if per else 0,
                recall=float(g[g.f==1].h.mean()), value=float(at_[(hit==1)&(yt==1)].sum()))
scale=EvidenceScale(n_bins=25).fit(rv,yv)
cal,_=SequentialTest.calibrated(scale,rv,yv,cv,dv,0.01,0.10)
sprt=metrics((cal.run(rt,ct,dt)[0]==1).astype(np.int8))
print(f"  {'':<32}{'innocent/day':>14}{'their txns':>13}{'worst':>8}{'recall':>9}{'value':>10}")
print("  "+"-"*88)
print(f"  {'Wald SPRT, calibrated (today)':<32}{sprt['stopped']:>14.2f}{100*sprt['txn']:>12.3f}%"
      f"{sprt['worst']:>8}{100*sprt['recall']:>8.1f}%{('₹%.1fM'%(sprt['value']/1e6)):>10}")
res={"sprt":sprt,"desk":{}}
for cap in (20, 50, 100, 200):
    m=metrics(run_desk(cap,4)); res["desk"][cap]=m
    print(f"  {('desk, '+str(cap)+' customers/day'):<32}{m['stopped']:>14.2f}{100*m['txn']:>12.3f}%"
          f"{m['worst']:>8}{100*m['recall']:>8.1f}%{('₹%.1fM'%(m['value']/1e6)):>10}")
json.dump(res, open("/root/ship/verdict.json","w"), indent=1, default=float)
