import os
import sys
import cv2
import numpy as np
import base64
import psycopg2
import face_recognition
import threading
import requests
import time
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_URL = os.environ.get("DATABASE_URL", "postgresql://admin:password123@db:5432/attendance_system")
RTSP_URL = os.environ.get("RTSP_URL", "rtsp://localhost:8554/camera")
WEBHOOK_URL = "http://attendance_backend:3000/api/webhook/rosto_detectado"


def get_db_connection():
    return psycopg2.connect(DB_URL)


def _open_capture(url):
    """Open VideoCapture while suppressing FFmpeg's C-level stderr noise."""
    devnull_fd = os.open(os.devnull, os.O_WRONLY)
    saved_stderr = os.dup(2)
    os.dup2(devnull_fd, 2)
    try:
        cap = cv2.VideoCapture(url)
    finally:
        os.dup2(saved_stderr, 2)
        os.close(saved_stderr)
        os.close(devnull_fd)
    return cap


# ==========================================
# Background RTSP worker (Server Push architecture)
# ==========================================
def rtsp_worker():
    frame_count = 0
    cap = None

    while True:
        try:
            if cap is None or not cap.isOpened():
                print(f"[RTSP] Connecting to {RTSP_URL}...", flush=True)
                cap = _open_capture(RTSP_URL)
                if not cap.isOpened():
                    print("[RTSP] Failed to open stream. Retrying in 15s.", flush=True)
                    time.sleep(15)
                    continue

            ret, frame = cap.read()
            if not ret:
                print("[RTSP] Stream lost. Reconnecting...", flush=True)
                cap.release()
                cap = None
                time.sleep(2)
                continue

            frame_count += 1
            # CPU saving: process 1 out of every 5 frames
            if frame_count % 5 != 0:
                continue

            frame_height, frame_width = frame.shape[:2]
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            face_locations = face_recognition.face_locations(rgb_frame)
            if not face_locations:
                continue

            top, right, bottom, left = face_locations[0]
            box = {"top": top, "right": right, "bottom": bottom, "left": left}

            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
            if not face_encodings:
                continue

            embedding = face_encodings[0].tolist()
            embedding_str = '[' + ','.join(map(str, embedding)) + ']'

            conn = get_db_connection()
            cur = conn.cursor()
            query = """
                SELECT nome, tipo, documento,
                       (1 - (foto_embedding <=> %s::vector)) as confidence
                FROM pessoas
                ORDER BY foto_embedding <=> %s::vector
                LIMIT 1;
            """
            cur.execute(query, (embedding_str, embedding_str))
            result = cur.fetchone()
            cur.close()
            conn.close()

            if not result:
                continue

            # SELECT returns: nome, tipo, documento, confidence  (4 columns)
            nome_banco, tipo, documento, confidence = (
                result[0], result[1], result[2], float(result[3])
            )
            print(f"[RTSP] {documento} ({nome_banco}) | Tipo: {tipo} | Confiança: {confidence:.4f}", flush=True)

            if confidence >= 0.945:
                try:
                    requests.post(WEBHOOK_URL, json={
                        "nome": nome_banco,
                        "tipo": tipo,
                        "documento": documento,
                        "confidence": confidence,
                        "box": box,
                        "frame_width": frame_width,
                        "frame_height": frame_height
                    }, timeout=3)
                except Exception as webhook_err:
                    print(f"[RTSP] Webhook error: {webhook_err}", flush=True)

        except Exception as e:
            print(f"[RTSP] Unexpected error: {e}", flush=True)
            if cap:
                cap.release()
                cap = None
            time.sleep(2)


# ==========================================
# /recognize  (tablet / manual frame fallback)
# ==========================================
@app.route('/recognize', methods=['POST'])
def recognize():
    data = request.json

    if not data or 'image' not in data:
        return jsonify({"error": "No image received"}), 400

    try:
        image_b64 = data['image']
        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]

        img_data = base64.b64decode(image_b64)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb_img)

        if len(face_locations) == 0:
            return jsonify({"error": "No face detected in the image"}), 404

        top, right, bottom, left = face_locations[0]
        box = {"top": top, "right": right, "bottom": bottom, "left": left}

        face_encodings = face_recognition.face_encodings(rgb_img, face_locations)
        embedding = face_encodings[0].tolist()
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'

        conn = get_db_connection()
        cur = conn.cursor()
        query = """
            SELECT nome, tipo, documento,
                   (1 - (foto_embedding <=> %s::vector)) as confidence
            FROM pessoas
            ORDER BY foto_embedding <=> %s::vector
            LIMIT 1;
        """
        cur.execute(query, (embedding_str, embedding_str))
        result = cur.fetchone()
        cur.close()
        conn.close()

        if result:
            # SELECT returns: nome, tipo, documento, confidence  (4 columns)
            nome_banco, tipo, documento, confidence = (
                result[0], result[1], result[2], float(result[3])
            )
            print(f"DEBUG BIOMETRIA -> {documento} ({nome_banco}) | Tipo: {tipo} | Confiança: {confidence:.4f}", flush=True)

            if confidence >= 0.945:
                return jsonify({
                    "match": True,
                    "nome": nome_banco,
                    "tipo": tipo,
                    "documento": documento,
                    "confidence": confidence,
                    "box": box
                }), 200
            else:
                return jsonify({"match": False, "message": "Confiança muito baixa", "box": box}), 200
        else:
            return jsonify({"match": False, "message": "Banco vazio", "box": box}), 200

    except Exception as e:
        print("Internal error:", str(e))
        return jsonify({"error": str(e)}), 500


# ==========================================
# /cadastrar  (ETL sync + manual enrollment)
# ==========================================
@app.route('/cadastrar', methods=['POST'])
def cadastrar():
    data = request.json

    if not data or 'image' not in data or 'documento' not in data or 'nome' not in data or 'tipo' not in data:
        return jsonify({"error": "Missing data. Send image, documento, nome, and tipo."}), 400

    try:
        image_b64 = data['image']
        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]

        img_data = base64.b64decode(image_b64)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        face_encodings = face_recognition.face_encodings(rgb_img)

        if len(face_encodings) == 0:
            return jsonify({"error": "No face detected in the image."}), 400

        if len(face_encodings) > 1:
            return jsonify({"error": "Multiple faces detected. Send a photo with only one person."}), 400

        embedding = face_encodings[0].tolist()
        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        documento = data['documento']

        conn = get_db_connection()
        cur = conn.cursor()
        query = """
            INSERT INTO pessoas (nome, tipo, documento, foto_embedding)
            VALUES (%s, %s, %s, %s::vector)
            ON CONFLICT (documento) DO UPDATE
            SET foto_embedding = EXCLUDED.foto_embedding,
                nome = EXCLUDED.nome,
                tipo = EXCLUDED.tipo;
        """
        cur.execute(query, (data['nome'], data['tipo'], documento, embedding_str))
        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"message": f"Person {data['nome']} (doc: {documento}) registered successfully!"}), 201

    except Exception as e:
        print("Registration error:", str(e))
        return jsonify({"error": str(e)}), 500


# ==========================================
# Sync management endpoints
# ==========================================
@app.route('/users', methods=['GET'])
def list_users():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT documento FROM pessoas;")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify([row[0] for row in rows]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/users/<matricula>', methods=['DELETE'])
def delete_user(matricula):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM pessoas WHERE documento = %s;", (matricula,))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"message": f"User {matricula} deleted."}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/database/wipe', methods=['DELETE'])
def wipe_database():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("TRUNCATE TABLE pessoas;")
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"message": "Database wiped successfully."}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    worker_thread = threading.Thread(target=rtsp_worker, daemon=True)
    worker_thread.start()
    app.run(host='0.0.0.0', port=5000)
