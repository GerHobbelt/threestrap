describe("stats", function () {

  it("adds stats to the dom", function () {

    var options = {
      plugins: ['bind', 'renderer', 'stats'],
    };

    //id:stats removed from THREE.Stats lib
    expect(document.querySelector('canvas')).toBeFalsy();

    var three = new THREE.Bootstrap(options);

    expect(document.querySelector('canvas')).toBeTruthy();

    three.destroy();

    expect(document.querySelector('canvas')).toBeFalsy();
  });

});