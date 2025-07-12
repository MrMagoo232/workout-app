'use strict';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');
const btnUndo = document.querySelector('.btn--undo');
const btnReset = document.querySelector('.btn--reset');
const btnCancel = document.querySelector('.btn--cancel');
const btnFinish = document.querySelector('.btn--finish');
const modeControls = document.querySelector('.mode-controls');
const instructions = document.querySelector('.workout-instructions');
const helpBtn = document.querySelector('.help-btn');
const helpModal = document.querySelector('.help-modal');
const helpOverlay = document.querySelector('.help-modal__overlay');
const helpClose = document.querySelector('.help-modal__close');

////////////////////////////////////
//// Helper Functions
////////////////////////////////////

const autoInsertAdjacentHTML = function (
  htmlString,
  anchorEl,
  position,
  closestSelector
) {
  const validPositions = ['afterbegin', 'afterend', 'beforebegin', 'beforeend'];
  if (!validPositions.includes(position)) {
    console.error(`Invalid Position: position`);
    return;
  }
  const targetEl = closestSelector
    ? anchorEl.closest(closestSelector)
    : anchorEl;
  if (!targetEl) {
    console.error(
      'Target element not found. Check your closest selector or anchor element.'
    );
    return;
  }
  targetEl.insertAdjacentHTML(position, htmlString);
};

////////////////////////////////////
//// Data Classes
////////////////////////////////////

class Workout {
  date = new Date();
  id = Date.now().toString().slice(-10);

  constructor(coords, distance, duration) {
    this.coords = coords; // array of coordinates
    this.distance = distance; // in miles
    this.duration = duration; // in minutes
  }
}

class Running extends Workout {
  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.type = 'running';
  }
}

class Hiking extends Workout {
  constructor(coords, distance, duration, elevationGain) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    this.type = 'hiking';
  }
}

//////////////////////////////////////////////////
//// Application Architecture
//////////////////////////////////////////////////

class App {
  #map;
  #mapOnEvent;
  #routeCoords = [];
  segmentDistance = 0;
  #isMarkerAddingEnabled = true;
  #workouts = [];
  #findWorkoutHelper = [];
  #viewWorkoutPolylines = [];

  constructor() {
    this.workout = null;
    this._getPosition();
    modeControls.addEventListener(
      'click',
      this._mapMarkerControllers.bind(this)
    );
    inputType.addEventListener('change', this._toggleElevation);
    form.addEventListener('submit', this._newWorkout.bind(this));
    containerWorkouts.addEventListener('click', this._locateWorkout.bind(this));
    this._getStorage();

    helpBtn.addEventListener('click', () => {
      helpModal.classList.remove('hidden');
      helpOverlay.classList.remove('hidden');
    });

    helpClose.addEventListener('click', () => {
      helpModal.classList.add('hidden');
      helpOverlay.classList.add('hidden');
    });

    helpOverlay.addEventListener('click', () => {
      helpModal.classList.add('hidden');
      helpOverlay.classList.add('hidden');
    });
  }

  _getPosition() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        this._loadMap.bind(this),
        function () {
          throw new Error('Can not get current position');
        }
      );
    }
  }

  _loadMap(position) {
    const { latitude, longitude } = position.coords;

    this.#map = L.map('map').setView([latitude, longitude], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.#map);

    this.#map.on('click', this._addCoords.bind(this));

    this.#workouts.forEach(workout => {
      this.workout = workout;
      this._renderWorkoutMarker();
      this._renderWorkout();
    });

    this._toggleInstructions();
  }

  _toggleInstructions() {
    if (this.#workouts.length > 0) {
      instructions.classList.add('hidden');
    } else {
      instructions.classList.remove('hidden');
    }
  }

  _addCoords(mapOnEvent) {
    if (!this.#isMarkerAddingEnabled) return;
    this.#mapOnEvent = mapOnEvent;
    const { lat, lng } = this.#mapOnEvent.latlng;
    modeControls.classList.remove('hidden');

    const route = this.#routeCoords;

    let polyline = null;

    const routePoint = {
      lat,
      lng,
      segmentDistance: 0,
      marker: L.marker([lat, lng]).addTo(this.#map),
      polyline,
    };

    if (route.length >= 1) {
      const lastLeg = route[route.length - 1];
      const lastLat = lastLeg.lat;
      const lastLng = lastLeg.lng;
      routePoint.segmentDistance += this._calculateDistance(
        lastLat,
        lastLng,
        lat,
        lng
      );
      polyline = L.polyline(
        [
          [lastLat, lastLng],
          [lat, lng],
        ],
        { color: 'blue' }
      ).addTo(this.#map);
    }

    routePoint.polyline = polyline;
    route.push(routePoint);
  }

  _mapMarkerControllers(e) {
    if (e.target.classList.contains('btn--undo')) {
      const lastLeg = this.#routeCoords.pop();
      lastLeg.marker.remove();
      if (lastLeg.polyline) lastLeg.polyline.remove();
    }

    if (e.target.classList.contains('btn--cancel')) {
      if (this.#routeCoords.length === 0) return;

      this._clearRoute();
      this.#routeCoords = [];
      modeControls.classList.add('hidden');
    }

    if (e.target.classList.contains('btn--finish')) {
      const totalDistance = this.#routeCoords.reduce((sum, leg) => {
        sum += leg.segmentDistance;
        return sum;
      }, 0);

      inputDistance.value = totalDistance.toFixed(2);
      inputDistance.disabled = true;

      modeControls.classList.add('hidden');
      this._showForm();
      this.#isMarkerAddingEnabled = false;
    }
  }

  _clearRoute() {
    this.#routeCoords.forEach((leg, index) => {
      leg.marker.remove();
      if (index !== 0) leg.polyline.remove();
    });
    this._clearViewWorkoutPolylines();
  }

  _setPolylines() {
    this._clearRoute();

    const workout = this.#findWorkoutHelper[0];
    const coords = workout.coords;

    for (let i = 1; i < coords.length; i++) {
      const previous = coords[i - 1];
      const next = coords[i];

      const poly = L.polyline(
        [
          [previous.lat, previous.lng],
          [next.lat, next.lng],
        ],
        { color: 'blue' }
      ).addTo(this.#map);
      this.#viewWorkoutPolylines.push(poly);
    }

    const end = coords[coords.length - 1];

    const endMarker = L.circleMarker([end.lat, end.lng], {
      radius: 8,
      color: 'red',
      fillColor: 'red',
      fillOpacity: 1,
    })
      .addTo(this.#map)
      .bindPopup('Finish');

    this.#viewWorkoutPolylines.push(endMarker);
  }

  _clearViewWorkoutPolylines() {
    this.#viewWorkoutPolylines.forEach(poly => poly.remove());

    this.#viewWorkoutPolylines = [];
  }

  _showForm() {
    form.classList.remove('hidden');
    inputDuration.focus();
  }

  _hideForm() {
    form.classList.add('hidden');
  }

  _toggleElevation() {
    inputElevation.closest('.form__row').classList.toggle('form__row--hidden');
    inputCadence.closest('.form__row').classList.toggle('form__row--hidden');
  }

  _newWorkout(e) {
    e.preventDefault();

    const type = inputType.value;
    const duration = +inputDuration.value;
    const totalDistance = +inputDistance.value;

    const validInput = (...inputs) =>
      inputs.every(input => Number.isFinite(input));

    const allPositive = (...inputs) => inputs.every(input => input > 0);

    if (type === 'running') {
      const cadence = +inputCadence.value;

      if (
        !validInput(totalDistance, duration, cadence) ||
        !allPositive(totalDistance, duration, cadence)
      ) {
        throw new Error('Numbers are invalid');
      }

      this.workout = new Running(
        this.#routeCoords,
        totalDistance,
        duration,
        cadence
      );
    }

    if (type === 'hiking') {
      const elevation = +inputElevation.value;

      if (
        !validInput(totalDistance, duration, elevation) ||
        !allPositive(totalDistance, duration)
      ) {
        throw new Error('Numbers are invalid');
      }

      this.workout = new Hiking(
        this.#routeCoords,
        totalDistance,
        duration,
        elevation
      );
    }

    this.#workouts.push(this.workout);
    this._setStorage();

    this._renderWorkoutMarker();

    this._renderWorkout();

    form.classList.add('hidden');
    this.#isMarkerAddingEnabled = true;
    inputDistance.disabled = false;
    this.#routeCoords = [];
    this.workout = null;
    this._toggleInstructions();

    inputDuration.value = inputCadence.value = inputElevation.value = '';
  }

  _renderWorkoutMarker() {
    this._clearRoute();
    const { lat, lng } = this.workout.coords[0];

    L.marker([lat, lng]).addTo(this.#map).bindPopup('Workout').openPopup();
  }

  _renderWorkout() {
    const html = `<li class="workout workout--${
      this.workout.type === 'running' ? 'running' : 'cycling'
    }" data-id="${this.workout.id}">
          <h2 class="workout__title">${
            this.workout.type === 'running' ? 'Running' : 'Cycling'
          } on ${
      months[this.workout.date.getMonth()]
    } ${this.workout.date.getDate()}, ${this.workout.date.getFullYear()}</h2>
          <div class="workout__details">
            <span class="workout__icon">${
              this.workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'
            }</span>
            <span class="workout__value">${this.workout.distance}</span>
            <span class="workout__unit">km</span>
          </div>
          <div class="workout__details">
            <span class="workout__icon">⏱</span>
            <span class="workout__value">${this.workout.duration}</span>
            <span class="workout__unit">min</span>
          </div>
          <div class="workout__details">
            <span class="workout__icon">⚡️</span>
            <span class="workout__value">${
              this.workout.type === 'running'
                ? (this.workout.duration / this.workout.distance).toFixed(1)
                : (
                    this.workout.distance /
                    (this.workout.duration / 60)
                  ).toFixed(1)
            }</span>
            <span class="workout__unit">${
              this.workout.type === 'running' ? 'min/km' : 'km/h'
            }</span>
          </div>
          <div class="workout__details">
            <span class="workout__icon">${
              this.workout.type === 'running' ? '🦶🏼' : '⛰'
            }</span>
            <span class="workout__value">${
              this.workout.type === 'running'
                ? this.workout.cadence
                : this.workout.elevation
            }</span>
            <span class="workout__unit">${
              this.workout.type === 'running' ? 'spm' : 'm'
            }</span>
          </div>
        </li>`;

    autoInsertAdjacentHTML(html, form, 'afterend');
  }

  _locateWorkout(e) {
    if (!e.target.closest('.workout')) return;

    const clicked = e.target.closest('li');

    const workoutList = document.querySelectorAll('.workout');

    const findClicked = this.#workouts.find(workout => {
      return workout.id === clicked.dataset.id;
    });

    workoutList.forEach(workout => {
      workout.classList.remove('workout--active');
    });

    workoutList.forEach(workout => {
      if (workout.dataset.id === findClicked.id)
        workout.classList.add('workout--active');
    });

    // Make sure route is all visible in route

    const coords = findClicked.coords.map(point => [point.lat, point.lng]);

    const bounds = L.latLngBounds(coords);

    const lat = findClicked.coords[0].lat;
    const lng = findClicked.coords[0].lng;

    this.#map.fitBounds(bounds, {
      padding: [50, 50],
      animate: true,
      duration: 2,
    });

    this.#findWorkoutHelper = [findClicked];

    this._setPolylines();
  }

  _setStorage() {
    const plainWorkouts = this.#workouts.map(workout => ({
      id: workout.id,
      date: workout.date,
      type: workout.type,
      coords: workout.coords.map(point => ({
        lat: point.lat,
        lng: point.lng,
        segmentDistance: point.segmentDistance,
      })),
      distance: workout.distance,
      duration: workout.duration,
      cadence: workout.cadence ?? null,
      elevationGain: workout.elevationGain ?? null,
    }));

    localStorage.setItem('workouts', JSON.stringify(plainWorkouts));
  }

  _getStorage() {
    const data = JSON.parse(localStorage.getItem('workouts'));

    if (!data) return;

    data.forEach(workoutData => {
      let workout;
      if (workoutData.type === 'running') {
        workout = new Running(
          workoutData.coords,
          workoutData.distance,
          workoutData.duration,
          workoutData.cadence
        );
      } else if (workoutData.type === 'hiking') {
        workout = new Hiking(
          workoutData.coords,
          workoutData.distance,
          workoutData.duration,
          workoutData.elevationGain
        );
      }
      workout.id = workoutData.id;
      workout.date = new Date(workoutData.date);

      this.#workouts.push(workout);
    });
  }

  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in kilometers

    // Convert degrees to radians
    const toRadians = deg => deg * (Math.PI / 180);

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c; // Distance in kilometers

    return distance;
  }
}

const app = new App();
