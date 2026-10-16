import sys,json,re
src=open(sys.argv[1],encoding='utf8').read()
rows=[];i=0
for m in re.finditer(r"INSERT INTO `wp_posts` [^V]*VALUES\s*",src):
    i=m.end()
    while True:
        # parse a tuple
        assert src[i]=='(',src[i:i+50]
        i+=1;vals=[];cur=None
        while True:
            c=src[i]
            if c=="'":
                i+=1;buf=[]
                while True:
                    c=src[i]
                    if c=='\\': buf.append({'n':'\n','r':'\r','t':'\t','0':'\0'}.get(src[i+1],src[i+1]));i+=2;continue
                    if c=="'":
                        if src[i+1]=="'": buf.append("'");i+=2;continue
                        i+=1;break
                    buf.append(c);i+=1
                vals.append(''.join(buf))
            else:
                j=i
                while src[i] not in ',)': i+=1
                vals.append(src[j:i].strip())
            if src[i]==',': i+=1; 
            while src[i] in ' \n': i+=1
            if src[i]==')': i+=1;break
        rows.append(vals)
        while src[i] in ' \n': i+=1
        if src[i]==',': i+=1
        while src[i] in ' \n': i+=1
        if src[i]==';': break
cols=['ID','author','date','dategmt','content','title','excerpt','status','cs','ps','pw','name','tp','pg','mod','modg','cf','parent','guid','menu','type','mime','cc']
out=[dict(zip(cols,r)) for r in rows]
from collections import Counter
print(Counter((r['type'],r['status']) for r in out).most_common(30),file=sys.stderr)
json.dump(out,open(sys.argv[2],'w'))
