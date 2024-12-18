async function main() {
  const canvas = document.querySelector("#canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    return;
  }

  const meshProgramInfo = webglUtils.createProgramInfo(gl, [vs, fs]);

  const objHref = "../object/TERMINAL.obj";
  const response = await fetch(objHref);
  const text = await response.text();

  const obj = parseOBJ(text);
  const baseHref = new URL(objHref, window.location.href);
  const matTexts = await Promise.all(
    obj.materialLibs.map(async (filename) => {
      const matHref = new URL(filename, baseHref).href;
      const response = await fetch(matHref);
      return await response.text();
    })
  );
  const materials = parseMTL(matTexts.join("\n"));

  const textures = {
    defaultWhite: create1PixelTexture(gl, [0, 0, 0, 0]),
    defaultNormal: create1PixelTexture(gl, [128, 128, 255, 255]),
    glassBase: await createTexture(gl, "../images/GlassNew.png"),
    glassAlpha: await createTexture(gl, "../images/GlassNew.png"),
    greenPlastic: await createTexture(gl, "../images/Green-plastic.png"),
    greenPlasticNormal: await createTexture(
      gl,
      "../images/Green-plastic-normal.png"
    ),
    base: await createTexture(gl, "../images/Base.png"),
    baseNormal: await createTexture(gl, "../images/baseNewNormalAgain.png"),
    baseRoughness: await createTexture(gl, "../images/itemroughness.jpg"),
    cable: await createTexture(gl, "../images/Cable.png"),
    holes: await createTexture(gl, "../images/Holes.png"),
    holesNormal: await createTexture(gl, "../images/Holes-normal.png"),
    plug: await createTexture(gl, "../images/silver-bg-2.jpg"),
  };

  const materialTextures = {
    Clear_Glass: {
      diffuseMap: textures.glassBase,
      alphaMap: textures.glassAlpha,
      shininess: 450,
      specular: [1, 0.5, 0.5],
      opacity: 2.2,
    },
    Holes: {
      diffuseMap: textures.holes,
      normalMap: textures.holesNormal,
      shininess: 50,
      opacity: 1,
    },
    "Material.005": {
      diffuseMap: textures.cable,
      shininess: 250,
      specular: [0.5, 0.5, 0.5],
    },
    plug: {
      diffuseMap: textures.plug,
      shininess: 200,
      specular: [0.3, 0.3, 0.3],
      metallic: 1.0,
    },

    Material_009: {
      diffuse: [0.799099, 0.013702, 0.020289],
      shininess: 100,
      specular: [0.5, 0.5, 0.5],
    },
    MatteGreen: {
      diffuseMap: textures.greenPlastic,
      normalMap: textures.greenPlasticNormal,
      shininess: 0,
      specular: [0.14, 0.14, 0.14],
    },
    MattePlastic: {
      diffuseMap: textures.base,
      normalMap: textures.baseNormal,
      roughnessMap: textures.baseRoughness,
      shininess: 50,
      specular: [0.14, 0.14, 0.14],
    },
  };

  // Loop untuk menyesuaikan material dan memetakan tekstur
  for (const material of Object.values(materials)) {
    Object.entries(material)
      .filter(([key]) => key.endsWith("Map"))
      .forEach(([key, filename]) => {
        let texture = textures[filename];
        if (!texture) {
          const textureHref = new URL(filename, baseHref).href;
          texture = createTexture(gl, textureHref);
          textures[filename] = texture;
        }
        material[key] = texture;
      });
  }

  const defaultMaterial = {
    diffuse: [1, 1, 1],
    diffuseMap: textures.defaultWhite,
    ambient: [0, 0, 0],
    specular: [1, 1, 1],
    specularMap: textures.defaultWhite,
    shininess: 400,
    opacity: 1,
  };

  const parts = obj.geometries.map(({ material, data }) => {
    if (data.color) {
      if (data.position.length === data.color.length) {
        data.color = { numComponents: 3, data: data.color };
      }
    } else {
      data.color = { value: [1, 1, 1, 1] };
    }

    // Generate tangents if texcoord and normal exist
    if (data.texcoord && data.normal) {
      data.tangent = generateTangents(
        data.position,
        data.texcoord,
        data.indices
      );
    } else {
      data.tangent = { value: [1, 0, 0] };
    }

    // Ensure texcoord and normal exist
    if (!data.texcoord) {
      data.texcoord = { value: [0, 0] };
    }
    if (!data.normal) {
      data.normal = { value: [0, 0, 1] };
    }

    // Prepare the buffer info
    const bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);

    // Check if the material has a normal map, and set the normalMap if available
    const materialToUse = {
      ...defaultMaterial,
      ...materialTextures[material],
      normalMap:
        materialTextures[material]?.normalMap || textures.defaultNormal,
    };

    return {
      material: materialToUse,
      bufferInfo,
    };
  });

  // Sort parts by renderOrder
  parts.sort((a, b) => a.renderOrder - b.renderOrder);

  const extents = getGeometriesExtents(obj.geometries);
  const range = m4.subtractVectors(extents.max, extents.min);
  const objOffset = m4.scaleVector(
    m4.addVectors(extents.min, m4.scaleVector(range, 0.5)),
    -1
  );
  // For rotation control via drag
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let rotationX = 0;
  let rotationY = 0;

  // Initial values for reset
  const initialRotationX = 0;
  const initialRotationY = 0;

  // Zoom control via button
  let zoomFactor = 1.0;
  const initialZoomFactor = 1.0; // Initial zoom factor
  const cameraTarget = [0, 0, 0];
  const radius = m4.length(range) * 0.8;
  let cameraPosition = m4.addVectors(cameraTarget, [0, 0, radius]);
  const initialCameraPosition = [...cameraPosition]; // Save initial camera position
  const zNear = radius / 100;
  const zFar = radius * 3;

  // Animation control
  let isAnimationRunning = true;

  // Zoom functions
  function zoomIn() {
    zoomFactor *= 0.9;
  }

  function zoomOut() {
    zoomFactor *= 1.1;
  }

  // Function to reset view
  function resetView() {
    rotationX = initialRotationX;
    rotationY = initialRotationY;
    zoomFactor = initialZoomFactor;
    cameraPosition = [...initialCameraPosition];
  }

  // Function to toggle animation
  function toggleAnimation() {
    isAnimationRunning = !isAnimationRunning;
    const animationButton = document.getElementById("toggleAnimation");

    if (isAnimationRunning) {
      animationButton.innerHTML = `<p>Pause</p>`; // Change button text to 'Pause'
    } else {
      animationButton.innerHTML = `<p>Play</p>`; // Change button text to 'Play'
    }
  }

  // Dragging functions for rotation
  function startDrag(event) {
    isDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  }

  function stopDrag() {
    isDragging = false;
  }

  function drag(event) {
    if (!isDragging) return;

    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;

    const rotationSpeed = 0.01; // Adjust rotation sensitivity
    rotationY += deltaX * rotationSpeed;
    rotationX += deltaY * rotationSpeed;

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  }

  // Render function
  function render(time) {
    time *= 0.001;

    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);

    const fieldOfViewRadians = (60 * Math.PI) / 180;
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);

    const up = [0, 1, 0];

    // Update camera position based on zoom factor
    cameraPosition = m4.addVectors(cameraTarget, [0, 0, radius * zoomFactor]);

    const camera = m4.lookAt(cameraPosition, cameraTarget, up);
    const view = m4.inverse(camera);

    const sharedUniforms = {
      u_lightDirection: m4.normalize([-1, 3, 5]),
      u_view: view,
      u_projection: projection,
      u_viewWorldPosition: cameraPosition,
    };

    gl.useProgram(meshProgramInfo.program);
    webglUtils.setUniforms(meshProgramInfo, sharedUniforms);

    // Apply rotation only if animation is running
    let u_world;
    if (isAnimationRunning) {
      u_world = m4.yRotation(time + rotationY);
      u_world = m4.xRotate(u_world, rotationX);
    } else {
      u_world = m4.yRotation(rotationY);
      u_world = m4.xRotate(u_world, rotationX);
    }
    u_world = m4.translate(u_world, ...objOffset);

    for (const { bufferInfo, material } of parts) {
      webglUtils.setBuffersAndAttributes(gl, meshProgramInfo, bufferInfo);
      webglUtils.setUniforms(meshProgramInfo, { u_world }, material);
      webglUtils.drawBufferInfo(gl, bufferInfo);
    }

    requestAnimationFrame(render);
  }

  // Event listeners
  document.querySelector("#zoomIn").addEventListener("click", zoomIn);
  document.querySelector("#zoomOut").addEventListener("click", zoomOut);
  document
    .querySelector("#toggleAnimation")
    .addEventListener("click", toggleAnimation);
  document.querySelector("#reset").addEventListener("click", resetView);

  gl.canvas.addEventListener("mousedown", startDrag);
  gl.canvas.addEventListener("mouseup", stopDrag);
  gl.canvas.addEventListener("mousemove", drag);
  gl.canvas.addEventListener("mouseleave", stopDrag);

  requestAnimationFrame(render);
}

main();
