# 🤖 RobotRave — Human Motion to Humanoid Robot Control

RobotRave is a real-time system that maps **human body movement to a humanoid robot’s servo motions**, allowing a robot to mirror a person’s actions live using computer vision.

This project was built during **The Robot Rave Hackathon**, where our team explored multiple ways of making robots dance to music and humans. My personal contribution focused on **human-movement-to-robot-movement** using **MediaPipe pose estimation** and live servo control over WebSockets.

---

## ✨ What This Project Does

- Captures **human pose landmarks** using MediaPipe  
- Converts human joint positions into **servo angle commands**  
- Streams commands in **real time over WebSockets**  
- Controls a **TonyPi humanoid robot** using a Raspberry Pi backend  
- Enables live **human → robot motion mirroring**

---

## 🕺 Hackathon Context: The Robot Rave

This project was created at **The Robot Rave Hackathon**, organised by **Cocoa Ventures** and the **Society for Technological Advancement (SoTA)**.

**Event Details**
- 📍 Huckletree Oxford Circus, London, England  
- 🗓 Saturday 17 Jan – Sunday 18 Jan  
- 🎶 Hackathon + live robot dance competition at Maggie’s (London’s iconic 80s club)

**Hackathon Theme:**  
> *Make robots move to music.*

### What Our Team Built

Using a **TonyPi humanoid robot**, our team explored three approaches:

1. **Music → Dance** (audio-driven choreography)  
2. **Dance → Music** (movement-driven audio generation)  
3. **Human Movement → Robot Movement** *(this repository)*  

This repo contains the full implementation for **#3**, where the robot mirrors a human performer in real time.

---

## 🧠 Tech Stack

- Python 3  
- MediaPipe (pose estimation)  
- WebSockets  
- Raspberry Pi  
- TonyPi humanoid robot  
- Servo control + real-time networking  

---

## 🚀 How to Run

### 1️⃣ On the Robot (Raspberry Pi)

SSH into the robot:

```bash
ssh pi@raspberrypi.local
# or
ssh pi@<Robot's IP Address>
```

Enter the password when prompted.

If the port is already in use, free it:
```bash
sudo lsof -i :<port number, eg. 8766>
sudo kill $(sudo lsof -t -i :<port number, eg. 8766>)
```

Start the servo receiver:
```bash
python3 servo_receiver.py --port <port number, eg. 8766>
```

The robot is now ready to receive real-time movement commands.

### 2️⃣ On the Website (Client Side)

Connect to the robot’s WebSocket server:

```text
ws://<Robot's IP Address>:<port number, eg. 8766>
```
---

## 🧪 How It Works (High Level)

- Camera input captures a human performer
- MediaPipe extracts pose landmarks
- Joint positions are mapped to robot-safe servo angles
- Commands are streamed via WebSockets
- The TonyPi robot mirrors the motion live

---

## 🎯 Why This Matters

This project demonstrates:

- Real-time human–robot interaction
- Embodied AI through motion imitation
- Low-latency robot control using lightweight networking
- A creative intersection of robotics, art, and performance

---

## 🙌 Acknowledgements

- Cocoa Ventures & SoTA for organising Robot Rave
- The TonyPi platform
- Everyone who danced with robots that weekend 🪩🤖
