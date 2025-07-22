from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory
from werkzeug.utils import secure_filename
import os
import json
import random
import string
import datetime
from functools import wraps

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size
app.config['PROJECTS_FOLDER'] = 'projects'
app.config['ALLOWED_EXTENSIONS'] = {'wav', 'mp3', 'ogg', 'flac'}

# Ensure projects folder exists
if not os.path.exists(app.config['PROJECTS_FOLDER']):
    os.makedirs(app.config['PROJECTS_FOLDER'])

def generate_project_id():
    """Generate a random 12-character string for project ID"""
    return ''.join(random.choices(string.ascii_letters + string.digits, k=12))

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def get_project_size(project_id):
    """Calculate total size of files in a project folder"""
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    if not os.path.exists(project_path):
        return 0
    
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(project_path):
        for filename in filenames:
            if filename != 'project.json' and filename != 'history.json':  # Exclude metadata files
                filepath = os.path.join(dirpath, filename)
                total_size += os.path.getsize(filepath)
    return total_size

def project_exists(f):
    """Decorator to check if project exists"""
    @wraps(f)
    def decorated_function(project_id, *args, **kwargs):
        project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
        if not os.path.exists(project_path):
            return jsonify({'error': 'Project not found'}), 404
        return f(project_id, *args, **kwargs)
    return decorated_function

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/create-project', methods=['POST'])
def create_project():
    """Create a new project with a random ID"""
    project_id = generate_project_id()
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    
    # Create project folder
    os.makedirs(project_path, exist_ok=True)
    
    # Create project metadata
    project_data = {
        'id': project_id,
        'created': datetime.datetime.now().isoformat(),
        'samples': [],
        'pattern': [],
        'bpm': 120
    }
    
    with open(os.path.join(project_path, 'project.json'), 'w') as f:
        json.dump(project_data, f, indent=2)
    
    # Create history file
    history_data = {
        'changes': [
            {
                'timestamp': datetime.datetime.now().isoformat(),
                'action': 'project_created',
                'data': project_data
            }
        ]
    }
    
    with open(os.path.join(project_path, 'history.json'), 'w') as f:
        json.dump(history_data, f, indent=2)
    
    return jsonify({'project_id': project_id, 'redirect_url': f'/project/{project_id}'})

@app.route('/project/<project_id>')
@project_exists
def project_page(project_id):
    """Show project management page"""
    return render_template('project.html', project_id=project_id)

@app.route('/project/<project_id>/tracker')
@project_exists
def tracker_page(project_id):
    """Show tracker interface for a project"""
    return send_from_directory('static', 'tracker.html')

@app.route('/api/project/<project_id>/info')
@project_exists
def get_project_info(project_id):
    """Get project information"""
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    
    with open(os.path.join(project_path, 'project.json'), 'r') as f:
        project_data = json.load(f)
    
    project_data['total_size'] = get_project_size(project_id)
    project_data['max_size'] = 10 * 1024 * 1024  # 10MB
    
    return jsonify(project_data)

@app.route('/api/project/<project_id>/upload', methods=['POST'])
@project_exists
def upload_sample(project_id):
    """Upload an audio sample to a project"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    
    # Check project size limit
    current_size = get_project_size(project_id)
    if current_size + len(file.read()) > 10 * 1024 * 1024:  # 10MB limit
        return jsonify({'error': 'Project size limit exceeded (10MB)'}), 400
    
    file.seek(0)  # Reset file pointer after reading for size check
    
    filename = secure_filename(file.filename)
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    file_path = os.path.join(project_path, filename)
    
    # Save file
    file.save(file_path)
    
    # Update project data
    with open(os.path.join(project_path, 'project.json'), 'r') as f:
        project_data = json.load(f)
    
    project_data['samples'].append({
        'filename': filename,
        'uploaded': datetime.datetime.now().isoformat(),
        'size': os.path.getsize(file_path)
    })
    
    with open(os.path.join(project_path, 'project.json'), 'w') as f:
        json.dump(project_data, f, indent=2)
    
    # Add to history
    with open(os.path.join(project_path, 'history.json'), 'r') as f:
        history_data = json.load(f)
    
    history_data['changes'].append({
        'timestamp': datetime.datetime.now().isoformat(),
        'action': 'sample_uploaded',
        'data': {'filename': filename}
    })
    
    with open(os.path.join(project_path, 'history.json'), 'w') as f:
        json.dump(history_data, f, indent=2)
    
    return jsonify({'message': 'File uploaded successfully', 'filename': filename})

@app.route('/api/project/<project_id>/samples/<filename>')
@project_exists
def get_sample(project_id, filename):
    """Serve audio sample files"""
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    return send_from_directory(project_path, filename)

@app.route('/api/project/<project_id>/save-pattern', methods=['POST'])
@project_exists
def save_pattern(project_id):
    """Save the current pattern"""
    data = request.get_json()
    if not data or 'pattern' not in data:
        return jsonify({'error': 'Invalid data'}), 400
    
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    
    # Update project data
    with open(os.path.join(project_path, 'project.json'), 'r') as f:
        project_data = json.load(f)
    
    project_data['pattern'] = data['pattern']
    project_data['bpm'] = data.get('bpm', 120)
    project_data['last_modified'] = datetime.datetime.now().isoformat()
    
    with open(os.path.join(project_path, 'project.json'), 'w') as f:
        json.dump(project_data, f, indent=2)
    
    # Add to history
    with open(os.path.join(project_path, 'history.json'), 'r') as f:
        history_data = json.load(f)
    
    history_data['changes'].append({
        'timestamp': datetime.datetime.now().isoformat(),
        'action': 'pattern_saved',
        'data': {'pattern': data['pattern'], 'bpm': data.get('bpm', 120)}
    })
    
    with open(os.path.join(project_path, 'history.json'), 'w') as f:
        json.dump(history_data, f, indent=2)
    
    return jsonify({'message': 'Pattern saved successfully'})

@app.route('/api/project/<project_id>/load-pattern')
@project_exists
def load_pattern(project_id):
    """Load the current pattern"""
    project_path = os.path.join(app.config['PROJECTS_FOLDER'], project_id)
    
    with open(os.path.join(project_path, 'project.json'), 'r') as f:
        project_data = json.load(f)
    
    return jsonify({
        'pattern': project_data.get('pattern', []),
        'bpm': project_data.get('bpm', 120),
        'samples': project_data.get('samples', [])
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
