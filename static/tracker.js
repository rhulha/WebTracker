$(document).ready(function() {
    // Global variables for playback control
    let isPlaying = false;
    let isPaused = false;
    let currentStep = 0;
    let intervalId = null;
    let bpm = 120;
    let nextStepTime = 0;
    let lookAhead = 25.0; // How frequently to call scheduling function (in milliseconds)
    let scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)
    
    // Web Audio API variables
    let audioContext;
    let audioBuffers = {};
    
    // Project variables
    let projectId = null;
    let projectSamples = [];
    let instruments = [];

    const stepsPerPattern = 16*4; // Number of steps in the pattern

    // Get project ID from URL
    function getProjectId() {
        const pathParts = window.location.pathname.split('/');
        const projectIndex = pathParts.indexOf('project');
        if (projectIndex !== -1 && projectIndex + 1 < pathParts.length) {
            return pathParts[projectIndex + 1];
        }
        return null;
    }

    // Initialize project
    async function initProject() {
        projectId = getProjectId();
        if (!projectId) {
            showError('No project ID found in URL');
            return;
        }

        $('#projectId').text(`Project: ${projectId}`);
        $('#backToProject').on('click', function() {
            window.location.href = `/project/${projectId}`;
        });

        try {
            await loadProjectData();
            await initAudio();
            generateTrackerTable();
            loadPattern();
            $('#loading').hide();
        } catch (error) {
            showError('Failed to initialize project: ' + error.message);
        }
    }

    // Load project data
    async function loadProjectData() {
        const response = await fetch(`/api/project/${projectId}/load-pattern`);
        if (!response.ok) {
            throw new Error('Failed to load project data');
        }
        
        const data = await response.json();
        projectSamples = data.samples || [];
        bpm = data.bpm || 120;
        
        // Set up instruments based on available samples
        instruments = projectSamples.map(sample => sample.filename);
        
        if (instruments.length === 0) {
            // Use default instruments if no samples
            instruments = ['Bass Drum', 'Snare', 'Hi Hat'];
        }

        // Update BPM display
        $('#bpmInput').val(bpm);
        $('#bpmDisplay').text(bpm);
    }

    // Show error message
    function showError(message) {
        $('#error').text(message).show();
        $('#loading').hide();
    }

    // Generate tracker table
    function generateTrackerTable() {
        const table = $('#tracker');
        table.empty(); // Clear existing content
        
        // Add header row with step numbers
        const headerRow = $('<tr></tr>');
        headerRow.append('<td class="instrument-header">Instrument</td>'); // Instrument column header
        for (let step = 1; step <= stepsPerPattern; step++) {
            headerRow.append(`<td class="step-header">${step}</td>`);
        }
        table.append(headerRow);
        
        // Add instrument rows
        instruments.forEach((instrumentName, index) => {
            const row = $('<tr></tr>');
            row.attr('data-instrument', index);
            
            // Add instrument name cell
            const nameCell = $(`<td class="instrument-name">${instrumentName}</td>`);
            row.append(nameCell);
            
            // Add pattern cells
            for (let step = 0; step < stepsPerPattern; step++) {
                const stepCell = $('<td class="step-cell">&nbsp;</td>');
                stepCell.attr('data-step', step);
                row.append(stepCell);
            }
            
            table.append(row);
        });
    }

    // Calculate interval based on BPM (16th notes)
    function getBeatInterval() {
        return (60000 / bpm) / 4; // 4 subdivisions per beat for 16th notes
    }
    
    // Initialize Web Audio API
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            return loadAudioFiles();
        } catch (error) {
            console.error('Web Audio API not supported:', error);
            throw error;
        }
    }
    
    // Load all audio files
    async function loadAudioFiles() {
        const loadPromises = [];
        
        for (let i = 0; i < projectSamples.length; i++) {
            const sample = projectSamples[i];
            const loadPromise = loadAudioFile(i, `/api/project/${projectId}/samples/${sample.filename}`);
            loadPromises.push(loadPromise);
        }
        
        await Promise.all(loadPromises);
    }
    
    // Load individual audio file
    async function loadAudioFile(index, url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            audioBuffers[index] = audioBuffer;
            console.log(`Loaded ${url}`);
        } catch (error) {
            console.error(`Error loading ${url}:`, error);
            // Don't throw error for individual file failures
        }
    }
    
    // Play audio sample with precise timing
    function playAudioSample(instrumentIndex, when = 0) {
        if (!audioContext || !audioBuffers[instrumentIndex]) {
            return;
        }
        
        // Resume audio context if suspended (required by some browsers)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffers[instrumentIndex];
        source.connect(audioContext.destination);
        source.start(when);
    }

    // Update BPM display and internal value
    function updateBPM() {
        bpm = parseInt($('#bpmInput').val());
        $('#bpmDisplay').text(bpm);
    }

    // Start playback
    function startPlayback() {
        if (isPaused) {
            // Resume from current position
            isPaused = false;
        } else {
            // Start from beginning
            currentStep = 0;
            nextStepTime = audioContext.currentTime;
        }
        
        isPlaying = true;
        scheduler();
        updatePlaybackButtons();
    }

    // Stop playback
    function stopPlayback() {
        isPlaying = false;
        isPaused = false;
        currentStep = 0;
        
        if (intervalId) {
            clearTimeout(intervalId);
            intervalId = null;
        }
        
        clearStepHighlight();
        updatePlaybackButtons();
    }

    // Pause playback
    function pausePlayback() {
        if (isPlaying) {
            isPlaying = false;
            isPaused = true;
            
            if (intervalId) {
                clearTimeout(intervalId);
                intervalId = null;
            }
            
            updatePlaybackButtons();
        }
    }

    // Precise audio scheduler
    function scheduler() {
        // While there are notes that will need to play before the next interval, schedule them
        while (nextStepTime < audioContext.currentTime + scheduleAheadTime) {
            scheduleStep(currentStep, nextStepTime);
            nextStep();
        }
        
        if (isPlaying) {
            intervalId = setTimeout(scheduler, lookAhead);
        }
    }
    
    // Schedule a single step
    function scheduleStep(stepNumber, time) {
        // Update visual highlight on the main thread (not audio-precise timing)
        setTimeout(() => {
            if (isPlaying) {
                updateStepHighlight(stepNumber);
            }
        }, (time - audioContext.currentTime) * 1000);
        
        // Check each instrument row for active cells at current step
        $('#tracker tr[data-instrument]').each(function() {
            const instrumentIndex = parseInt($(this).attr('data-instrument'));
            const currentCell = $(this).find(`td[data-step="${stepNumber}"]`);
            
            // Play audio if this cell is active - use precise timing
            if (currentCell.hasClass('active')) {
                playAudioSample(instrumentIndex, time);
            }
        });
    }
    
    // Move to next step and calculate next step time
    function nextStep() {
        const secondsPerStep = (60.0 / bpm) / 4; // 16th notes
        nextStepTime += secondsPerStep;
        currentStep = (currentStep + 1) % stepsPerPattern;
    }
    
    // Update visual step highlight
    function updateStepHighlight(stepNumber) {
        // Clear previous step highlight
        $('.current-step').removeClass('current-step');
        
        // Highlight current step across all instruments
        $(`td[data-step="${stepNumber}"]`).addClass('current-step');
    }

    // Clear step highlight
    function clearStepHighlight() {
        $('.current-step').removeClass('current-step');
    }

    // Update button states
    function updatePlaybackButtons() {
        $('#startBtn').prop('disabled', isPlaying && !isPaused);
        $('#stopBtn').prop('disabled', !isPlaying && !isPaused);
        $('#pauseBtn').prop('disabled', !isPlaying);
    }

    // Save the current song pattern to server
    async function saveSong() {
        const songData = [];
        
        $('#tracker tr[data-instrument]').each(function() {
            const rowData = [];
            $(this).find('td[data-step]').each(function() {
                rowData.push($(this).hasClass('active'));
            });
            songData.push(rowData);
        });
        
        try {
            const response = await fetch(`/api/project/${projectId}/save-pattern`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pattern: songData,
                    bpm: bpm
                })
            });
            
            if (response.ok) {
                console.log('Pattern saved successfully');
                // Show brief success indicator
                const originalText = $('#saveBtn').text();
                $('#saveBtn').text('✅ Saved!');
                setTimeout(() => {
                    $('#saveBtn').text(originalText);
                }, 1000);
            } else {
                console.error('Failed to save pattern');
            }
        } catch (error) {
            console.error('Error saving pattern:', error);
        }
    }

    // Load the song pattern from server
    async function loadPattern() {
        try {
            const response = await fetch(`/api/project/${projectId}/load-pattern`);
            if (!response.ok) {
                return; // Silently fail if no saved pattern
            }
            
            const data = await response.json();
            const songData = data.pattern || [];
            
            if (songData.length === 0) {
                return; // No pattern to load
            }
            
            $('#tracker tr[data-instrument]').each(function(i) {
                if (i < songData.length) {
                    const rowData = songData[i];
                    $(this).find('td[data-step]').each(function(j) {
                        if (j < rowData.length) {
                            $(this).toggleClass('active', rowData[j]);
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error loading pattern:', error);
        }
    }

    // Function to clear all active cells
    function resetSong() {
        $('#tracker td').removeClass('active');
    }

    // Auto-save every 5 seconds when changes are made
    let autoSaveTimeout;
    function scheduleAutoSave() {
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }
        autoSaveTimeout = setTimeout(saveSong, 5000);
    }

    // Initialize on page load
    initProject();
    updatePlaybackButtons();

    // Event handlers
    $('#bpmInput').on('input', function() {
        updateBPM();
        scheduleAutoSave();
    });

    // Handle pattern cell clicks
    $('#tracker').on('click', 'td[data-step]', function() {
        const $cell = $(this);
        const $row = $cell.closest('tr');
        const instrumentIndex = parseInt($row.attr('data-instrument'));
        
        $cell.toggleClass('active');
        
        // Play audio preview when toggling a cell on
        if ($cell.hasClass('active') && audioBuffers[instrumentIndex]) {
            playAudioSample(instrumentIndex);
        }
        
        scheduleAutoSave();
    });

    // Handle button clicks
    $('#startBtn').on('click', startPlayback);
    $('#stopBtn').on('click', stopPlayback);
    $('#pauseBtn').on('click', pausePlayback);
    $('#resetBtn').on('click', function() {
        resetSong();
        scheduleAutoSave();
    });
    
    $('#saveBtn').on('click', saveSong);
    $('#loadBtn').on('click', loadPattern);
});
