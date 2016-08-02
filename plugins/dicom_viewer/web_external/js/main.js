import ViewTemplate from 'templates/view.jade';
import 'stylesheets/dicom_viewer.styl';

import dicomParser from 'dicom-parser';
import vtkImageSlice from 'vtk.js/Sources/Rendering/Core/ImageSlice';
import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';
import vtkInteractorStyleImage from 'vtk.js/Sources/Interaction/Style/InteractorStyleImage';
import vtkOpenGLRenderWindow from 'vtk.js/Sources/Rendering/OpenGL/RenderWindow';
import vtkRenderer from 'vtk.js/Sources/Rendering/Core/Renderer';
import vtkRenderWindow from 'vtk.js/Sources/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from 'vtk.js/Sources/Rendering/Core/RenderWindowInteractor';

import naturalSort from 'javascript-natural-sort';
naturalSort.insensitive = true;

girder.wrap(girder.views.ItemView, 'render', function (render) {
  this.once('g:rendered', function () {
    $('.g-item-header').after('<div id="g-dicom-view"></div>');
    new girder.views.DicomView({
      el: $('#g-dicom-view'),
      parentView: this,
      item: this.model
    });
  }, this);
  render.call(this);
});

girder.views.DicomView = girder.View.extend({
  events: {},

  initialize: function (settings) {
    this.item = settings.item;
    this.files = [];
    this.index = 0;
    this.first = true;
    this.render();
    this.initVtk();
    this.loadFileList();
  },

  step: function () {
    if (this.files.length <= 0) {
      return;
    }
    this.index = (this.index + 1) % this.files.length;
    const file = this.files[this.index];
    this.loadFile(file);
  },

  loadFileList: function () {
    girder.restRequest({
      path: '/item/' + this.item.get('_id') + '/files',
      data: {
        limit: 0
      }
    }).done(_.bind(function (resp) {
      this.handleFileList(resp);
    }, this));
  },

  handleFileList: function (files) {
    files = files.sort((a, b) => naturalSort(a.name, b.name));
    this.files = files;
    this.step();
  },

  loadFile: function (file) {
    console.log(file.name);
    const req = new XMLHttpRequest();
    req.open('GET', girder.apiRoot + '/file/' + file._id + '/download', true);
    req.responseType = 'arraybuffer';
    req.onload = _.bind(function (event) {
      let imageData = null;
      try {
        const byteArray = new Uint8Array(req.response);
        const dataSet = dicomParser.parseDicom(byteArray);
        imageData = createImageData(dataSet);
      }
      catch (e) {
      }
      if (imageData) {
        this.handleImageData(imageData);
        setTimeout(this.step.bind(this), 1000);
      } else {
        setTimeout(this.step.bind(this), 1);
      }
    }, this);
    req.send();
  },

  handleImageData: function (imageData) {
    this.setImageData(imageData);
  },

  render: function () {
    this.$el.html(ViewTemplate());
    return this;
  },

  setImageData: function (imageData) {
    const mapper = vtkImageMapper.newInstance();
    mapper.setInputData(imageData);
    this.actor.setMapper(mapper);

    if (this.first) {
      const range = imageData.getPointData().getScalars().getRange();
      const ww = range[1] - range[0];
      const wc = (range[0] + range[1]) / 2;
      this.actor.getProperty().setColorWindow(ww);
      this.actor.getProperty().setColorLevel(wc);
      this.ren.resetCamera();
      this.first = false;
      const bounds = imageData.getBounds();
      const w = bounds[1];
      const h = bounds[3];
      const zoom = 512 / w;
      this.camera.zoom(512 / w);
    }

    this.iren.render();
  },

  initVtk: function () {
    const container = document.getElementById('g-dicom-container');

    const ren = vtkRenderer.newInstance();
    ren.setBackground(0.32, 0.34, 0.43);

    const renWin = vtkRenderWindow.newInstance();
    renWin.addRenderer(ren);

    const glWin = vtkOpenGLRenderWindow.newInstance();
    glWin.setContainer(container);
    glWin.setSize(512, 512);
    renWin.addView(glWin);

    const iren = vtkRenderWindowInteractor.newInstance();
    const style = vtkInteractorStyleImage.newInstance();
    iren.setInteractorStyle(style);
    iren.setView(glWin);

    const actor = vtkImageSlice.newInstance();
    ren.addActor(actor);

    const mapper = vtkImageMapper.newInstance();
    actor.setMapper(mapper);

    // empty data
    const imageData = vtkImageData.newInstance();
    const values = new Float32Array(1);
    const dataArray = vtkDataArray.newInstance({values: values});
    imageData.getPointData().addArray(dataArray);
    imageData.setExtent(0, 0, 0, 0, 0, 0);
    mapper.setInputData(imageData);

    const camera = ren.getActiveCameraAndResetIfCreated();
    camera.zoom(1.4);

    iren.initialize();
    iren.bindEvents(container, document);
    iren.start();

    this.actor = actor;
    this.ren = ren;
    this.iren = iren;
    this.camera = camera;
  }

});

function createImageData(dataSet) {
  const accessionNumber = dataSet.string('x00080050');

  const rows = dataSet.int16('x00280010');
  const cols = dataSet.int16('x00280011');
  const rowSpacing = dataSet.floatString('x00280030', 0);
  const colSpacing = dataSet.floatString('x00280030', 1);

  const element = dataSet.elements.x7fe00010;
  const pixelData = new Int16Array(
    dataSet.byteArray.buffer, element.dataOffset, element.length / 2);

  const imageData = vtkImageData.newInstance();
  // imageData.setOrigin(0, 0, 0);
  imageData.setSpacing(colSpacing, rowSpacing, 1);
  imageData.setExtent(0, cols - 1, 0, rows - 1, 0, 0);

  const values = new Float32Array(pixelData.length);
  for (let i = 0; i < values.length; i++) {
    values[i] = (pixelData[i]) / 128;
  }

  const dataArray = vtkDataArray.newInstance({values: values});
  imageData.getPointData().addArray(dataArray);

  return imageData;
}

