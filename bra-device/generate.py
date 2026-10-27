#!/usr/bin/env python3
"""Generate deterministic metric and paragraph-candidate JSON from local ritual records."""
import argparse, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def load(path):
    with Path(path).open(encoding="utf-8") as f: return json.load(f)
def join(value):
    if isinstance(value,str): return value.strip()
    if isinstance(value,list): return " ".join(join(x) for x in value if join(x))
    return ""
def generate(data):
    summary=data.get("summary",{}); records=sorted(data.get("records",[]),key=lambda r:(r.get("date",""),r.get("type","")))
    source=data.get("source","input JSON")
    dates=[r.get("date") for r in records if r.get("date")]
    morning=int(summary.get("morning_count",sum(r.get("type")=="morning" for r in records)))
    closing=int(summary.get("closing_count",sum(r.get("type") in ("closing","evening","wrapup") for r in records)))
    candidates=[]
    for r in records:
        date=r.get("date","날짜 미기록"); episode=join(r.get("episode")); feedback=join(r.get("peer_feedback"))
        scene=join(r.get("comfortable_scene")); strength=join(r.get("strength")); action=join(r.get("first_action"))
        if episode: candidates.append({"ability":"자기조절력","date":date,"candidate":f"{date} 기록에는 피곤함에도 하루를 준비하고 등원한 장면이 남아 있다: {episode}","evidence":episode,"source":source})
        if feedback: candidates.append({"ability":"대인관계력","date":date,"candidate":f"{date} 동료 피드백은 먼저 밝게 인사하는 행동이 주변에 긍정적으로 닿았다고 설명한다: {feedback}","evidence":feedback,"source":source})
        detail=" ".join(x for x in (scene,("강점: "+strength) if strength else "",("다음 행동: "+action) if action else "") if x)
        if detail: candidates.append({"ability":"자기동기력","date":date,"candidate":f"{date} 기록은 학습 목표를 확인하고 다음 행동을 정하는 방식으로 동기를 실행 계획으로 옮긴다: {detail}","evidence":detail,"source":source})
    return {"generator_version":"1.0.0","source":source,"metrics":[{"label":"아침 리추얼 기록","value":morning,"unit":"회","source":source},{"label":"마무리 리추얼 기록","value":closing,"unit":"회","source":source},{"label":"기록된 날짜 범위","value":f"{summary.get('record_period_start',min(dates) if dates else '미기록')} ~ {summary.get('record_period_end',max(dates) if dates else '미기록')}","source":source}],"record_count_in_input":len(records),"candidates":candidates,"review_note":"문단 후보는 초안이다. 사실 확인과 본인 승인을 거친 문장만 공개 사이트에 반영한다."}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--input",default="input/ritual_records.json"); ap.add_argument("--output",default="output/latest_result.json"); a=ap.parse_args()
    result=generate(load(ROOT/a.input)); out=ROOT/a.output; out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Generated: {out.relative_to(ROOT)}"); print(f"Metrics: morning={result['metrics'][0]['value']}, closing={result['metrics'][1]['value']}"); print(f"Candidates: {len(result['candidates'])}"); print("SHA256: "+hashlib.sha256(out.read_bytes()).hexdigest())
if __name__=="__main__": main()
