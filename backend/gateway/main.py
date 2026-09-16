import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from confluent_kafka import Consumer, KafkaError

app = FastAPI(title="UK Carbon Intensity Stream Gateway")

# 1. Enable CORS so your React development server can talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Connection Manager to track open browser tabs
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"🔌 Browser connected! Total clients streaming: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print(f"❌ Browser disconnected. Remaining clients: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        """Send the streaming Kafka message to ALL connected React tabs simultaneously"""
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass # Handle dead sockets gracefully

manager = ConnectionManager()

# 3. Background Task: Pull messages from Docker Kafka and stream them to WebSockets
async def kafka_consumer_loop():
    kafka_config = {
        'bootstrap.servers': 'localhost:9092',
        'group.id': 'native-gateway-group',
        'auto.offset.reset': 'latest'
    }
    
    consumer = Consumer(kafka_config)
    consumer.subscribe(['uk-grid-carbon-intensity'])
    
    print("🤖 Native Kafka Consumer loop activated. Waiting for messages...")
    
    try:
        while True:
            # Poll Kafka for records (non-blocking yield)
            msg = consumer.poll(0.1)
            if msg is None:
                await asyncio.sleep(0.1)
                continue
                
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"⚠️ Kafka Error: {msg.error()}")
                continue

            # Extract the raw message payload string
            payload_str = msg.value().decode('utf-8')
            print(f"📩 Forwarding data: {payload_str[:60]}...")
            
            # Broadcast the live data out to the open WebSockets!
            await manager.broadcast(payload_str)
            
    except Exception as e:
        print(f"❌ Exception inside consumer loop: {e}")
    finally:
        consumer.close()

# 4. Trigger the background Kafka worker when FastAPI wakes up
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(kafka_consumer_loop())

# 5. The active WebSocket route for your React App frontend
@app.websocket("/ws/grid")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; look out for any incoming client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)