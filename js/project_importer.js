// My addons to the site
// Imports images for the slidShow

function load_pictures(name, fileType, number){
  if (typeof name === 'string' || name instanceof String){
    var pictureUl = document.getElementById('pictureul');
    console.log(pictureUl);
    if (pictureUl != null) {

      for (var i = 0; i <= number; i++) {
        var li = document.createElement('li');
        var im = document.createElement('img');
        im.src = name + i.toString() + fileType;
        li.appendChild(im);
        pictureUl.appendChild(li);
      }


    }else {
      console.error("Invalid image ul! In load_pictures, pictureul not found.");
    }
  } else {
    console.error("Invalid project name! In load_pictures, name = " + name + " is not a string");
  }
}
