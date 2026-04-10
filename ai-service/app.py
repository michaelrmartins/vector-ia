import os
import cv2
import numpy as np
import base64
import psycopg2
import face_recognition
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_URL = os.environ.get("DATABASE_URL", "postgresql://admin:password123@db:5432/attendance_system")

def get_db_connection():
    return psycopg2.connect(DB_URL)

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

        # Step 1: Face detection
        face_locations = face_recognition.face_locations(rgb_img)

        if len(face_locations) == 0:
            return jsonify({"error": "No face detected in the image"}), 404

        top, right, bottom, left = face_locations[0]
        bounding_box = {"top": top, "right": right, "bottom": bottom, "left": left}

        # Step 2: Extract face embedding
        face_encodings = face_recognition.face_encodings(rgb_img, face_locations)
        embedding = face_encodings[0].tolist()

        conn = get_db_connection()
        cur = conn.cursor()

        query = """
            SELECT matricula, (1 - (foto_embedding <=> %s::vector)) as confidence
            FROM alunos
            ORDER BY foto_embedding <=> %s::vector
            LIMIT 1;
        """

        embedding_str = '[' + ','.join(map(str, embedding)) + ']'
        cur.execute(query, (embedding_str, embedding_str))
        result = cur.fetchone()

        cur.close()
        conn.close()

        if result:
            matricula, confidence = result
            return jsonify({
                "matricula": matricula,
                "confidence": float(confidence),
                "box": bounding_box
            }), 200
        else:
            return jsonify({"error": "Database is empty"}), 404

    except Exception as e:
        print("Internal error:", str(e))
        return jsonify({"error": str(e)}), 500

@app.route('/cadastrar', methods=['POST'])
def cadastrar():
    data = request.json

    if not data or 'image' not in data or 'matricula' not in data or 'nome' not in data:
        return jsonify({"error": "Missing data. Send image, matricula, and nome."}), 400

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

        conn = get_db_connection()
        cur = conn.cursor()

        embedding_str = '[' + ','.join(map(str, embedding)) + ']'

        # Upsert: update the face embedding if the student already exists
        query = """
            INSERT INTO alunos (matricula, nome, foto_embedding)
            VALUES (%s, %s, %s::vector)
            ON CONFLICT (matricula) DO UPDATE
            SET foto_embedding = EXCLUDED.foto_embedding,
                nome = EXCLUDED.nome;
        """

        cur.execute(query, (data['matricula'], data['nome'], embedding_str))
        conn.commit()

        cur.close()
        conn.close()

        return jsonify({"message": f"Student {data['nome']} (ID: {data['matricula']}) registered successfully!"}), 201

    except Exception as e:
        print("Registration error:", str(e))
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
