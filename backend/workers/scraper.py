import os
import json
import time
import requests
from confluent_kafka import Producer


# ── Config (env-driven so each Docker worker owns a different zone) ──
API_URL   = "https://api.carbonintensity.org.uk/regional"
TOPIC     = "uk-grid-carbon-intensity"
BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")
ZONE      = os.environ.get("WORKER_ZONE", "NORTH")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "300"))

# Which region ids this worker owns + which partition its zone maps to
ZONES = {
    "NORTH":    {"partition": 0, "regions": [1, 2, 3, 4, 5]},
    "MIDLANDS": {"partition": 1, "regions": [6, 7, 8, 9, 10]},
    "SOUTH":    {"partition": 2, "regions": [11, 12, 13, 14]},
}

def delivery_report(err, msg):
    if err is not None:
        print(f"❌ Delivery failed (region {msg.key()}): {err}")
    else:
        print(f"✅{msg.key().decode()} -> partition {msg.partition()} offset {msg.offset()}")


def fetch_regions():
    resp = requests.get(API_URL, timeout=15)
    resp.raise_for_status()
    window = resp.json()["data"][0]          # current half-hour window
    
    '''
    Retuen structure: 
    {
        "data":[
            {
                "from":"2026-06-18T09:00Z",
                "to":"2026-06-18T09:30Z",
                "regions":[
                    {
                        "regionid":1,
                        "dnoregion":"Scottish Hydro Electric Power Distribution",
                        "shortname":"North Scotland",
                        "intensity":{
                            "forecast":0,"index":"very low"
                        },
                        "generationmix":[
                            {"fuel":"biomass","perc":0},
                            {"fuel":"coal","perc":0},
                            {"fuel":"imports","perc":0},
                            {"fuel":"gas","perc":0},
                            {"fuel":"nuclear","perc":0},
                            {"fuel":"other","perc":0},
                            {"fuel":"hydro","perc":0},
                            {"fuel":"solar","perc":4.6},
                            {"fuel":"wind","perc":95.4}
                        ]
                    },
                    {
                        "regionid":2,
                        "dnoregion":"SP Distribution",
                        "shortname":"South Scotland",
                        "intensity":{
                            "forecast":1,
                            "index":"very low"
                        },
                        "generationmix":[
                            {"fuel":"biomass","perc":0.8},
                            {"fuel":"coal","perc":0},
                            {"fuel":"imports","perc":0},
                            {"fuel":"gas","perc":0},
                            {"fuel":"nuclear","perc":15.3},
                            {"fuel":"other","perc":0},
                            {"fuel":"hydro","perc":0},
                            {"fuel":"solar","perc":3.4},
                            {"fuel":"wind","perc":80.5}
                        ]
                    }, { ..... }
    
    '''
    return window["from"], window["to"], window["regions"]


def main():

    cfg          = ZONES[ZONE]
    my_regions   = set(cfg["regions"])
    my_partition = cfg["partition"]

    '''
    A Producer is the client object that sends messages into Kafka. 
    In Kafka's world there are two roles: producers write data to topics, consumers read it.
    '''
    producer = Producer({"bootstrap.servers": BOOTSTRAP})
    print(f"🛰️  Worker [{ZONE}] online — regions {sorted(my_regions)} -> partition {my_partition}")

    while True:
        try:
            w_from, w_to, regions = fetch_regions()
            for region in regions:
                rid = region["regionid"]
                if rid not in my_regions:
                    continue
                payload = {
                    "region_id":     rid,
                    "shortname":     region["shortname"],
                    "from":          w_from,
                    "to":            w_to,
                    "intensity":     region["intensity"],       # {forecast, index}
                    "generationmix": region["generationmix"],   # fuel breakdown
                }
                producer.produce(
                    topic=TOPIC,
                    key=str(rid),                 # ordering per region
                    value=json.dumps(payload),
                    partition=my_partition,       # North/Mid/South layout
                    callback=delivery_report,
                )
                
            '''
            flush() blocks until every message currently in the buffer has reached the broker 
            and been acknowledged back
            '''
            producer.flush()
            print(f"📡 [{ZONE}] published window {w_from} — sleeping {POLL_SECONDS}s")
        except Exception as e:
            print(f"⚠️  [{ZONE}] scrape failed: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()